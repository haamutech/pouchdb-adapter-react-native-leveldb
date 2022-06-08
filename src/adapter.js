const { LevelDB, destroyLevelDatabase } = require("./backend");
const { pad16 } = require("./utils");

const {
   winningRev: getWinningRev,
   traverseRevTree,
   compactTree,
   collectConflicts,
   latest: getLatest
} = require("pouchdb-merge");

const {
   safeJsonParse,
   safeJsonStringify
} = require("pouchdb-json");

const {
   MISSING_DOC,
   REV_CONFLICT,
   INVALID_ID,
   INVALID_REV,
   NOT_OPEN,
   BAD_ARG,
   MISSING_STUB,
   MISSING_BULK_DOCS,
   MISSING_ID,
   createError
} = require("pouchdb-errors");

const {
   allDocsKeysQuery,
   isDeleted,
   isLocalId,
   parseDoc,
   processDocs
 } = require("pouchdb-adapter-utils");

// https://github.com/pouchdb/pouchdb/blob/master/packages/node_modules/pouchdb-core/src/adapter.js

function makeApi(self, ...methods) {
   for (let i = 0; i < methods.length; ++i)
      self[methods[i].name] = methods[i].bind(self);
}

function documentStore(key) {
   return `document-store/${key ?? ""}`;
}

function bySequence(key) {
   return `by-sequence/${pad16(key)}`;
}

function metaStore(key) {
   return `meta-store/${key}`;
}

function docCountUpdateSeqKey() {
   return "doc_count+update_seq";
}

function RNLevelDBAdapter(opts, callback) {
   const databaseName = opts.name ? `${opts.name}.db` : undefined;

   function use() {
      if (!RNLevelDBAdapter.Handlers.has(databaseName))
         throw createError(NOT_OPEN);

      return RNLevelDBAdapter.Handlers.get(databaseName);
   }

   makeApi(this,

      function _info(callback) {
         const { docCount, updateSeq } = use();

         callback(null, {
            docCount,
            updateSeq,
            backend_adapter: "react-native-leveldb",
         });
      },

      function _bulkDocs(req, opts, callback) {

         // 'docs' is required in _bulkDocs
         if (!req?.docs)
            return callback(createError(MISSING_BULK_DOCS));

         // Create PouchDB internal document structures for input.
         const docs = req.docs.map(x => parseDoc({ ...x }, opts.new_edits !== false, this.__opts));
         const fetchedDocs = new Map();
         const handler = use();

         // Fetch existing docs.
         for (let i = 0; i < docs.length; ++i) {
            const id = docs[i].metadata.id;
            let metadata = fetchedDocs.get(id);

            if (!metadata) {
               metadata = safeJsonParse(handler.db.getStr(documentStore(id)));

               if (metadata)
                  fetchedDocs.set(id, metadata);
            }

            // Initialize revision map used to map particular revisions
            // to data sequences.
            docs[i].metadata.rev_map = metadata?.rev_map;
         }

         const results = [];

         processDocs(undefined, docs, this, fetchedDocs, null, results, (doc, rev, isWinningRevDeleted, isNewRevDeleted, isUpdate, delta, resultsIdx, callback) => {
            let docCountDelta = 0;

            // Decrement document count if we are deleting existing document.
            if (isUpdate) {
               if (isNewRevDeleted)
                  docCountDelta = -1;
            }

            // Increment document count since new document is created.
            else
               docCountDelta = +1;

            const nextSeq = ++handler.updateSeq;
            handler.docCount += docCountDelta;

            // Map next sequence number to revision.
            doc.metadata.rev_map = {
               ...doc.metadata.rev_map,
               [doc.metadata.rev]: nextSeq,
            };

            let metadataOk = false;
            let dataOk = !isNewRevDeleted;

            // Apply modifications to database.
            try {
               handler.db.put(documentStore(doc.metadata.id), safeJsonStringify(doc.metadata));
               metadataOk = true;

               // Write data if revision is not deleted.
               if (!isNewRevDeleted) {
                  handler.db.put(bySequence(nextSeq), safeJsonStringify(doc.data));
                  dataOk = true;
               }

               // Update database bookkeeping values.
               handler.db.put(
                  metaStore(docCountUpdateSeqKey()),

                  // TODO: should this have .buffer? Due to problems in node/jest 
                  // it gives headaches in unit testing: https://github.com/nodejs/node/issues/20978
                  Uint32Array.of(handler.docCount, handler.updateSeq));   

               results[resultsIdx] = {
                  ok: true,
                  id: doc.metadata.id,
                  rev: doc.metadata.rev,
               };
            }

            // Rollback the changes on error.
            catch (e) {
               if (metadataOk) {

                  // Revert metadata back when updating.
                  if (isUpdate && fetchedDocs.has(doc.metadata.id))
                     handler.db.put(documentStore(doc.metadata.id), safeJsonStringify(fetchedDocs.get(doc.metadata.id)));

                  // Otherwise, restore the state where document did not exist.
                  else
                     handler.db.delete(documentStore(doc.metadata.id));
               }

               // Revert data by deleting it.
               if (dataOk)
                  handler.db.delete(bySequence(nextSeq));

               // Revert database bookkeeping values.
               handler.docCount -= docCountDelta;
               --handler.updateSeq;

               results[resultsIdx] = e;
            }

            callback();
         }, opts, error => {
            callback(error, results);
         });
      },

      function _get(id, opts, callback) {
         // TODO: support opts.revs
         // TODO: support opts.rev_info
         // TODO: support opts.open_revs
         // TODO: support opts.conflicts
         // TODO: support opts.attachments

         const { db } = use();
         const metadata = safeJsonParse(db.getStr(documentStore(id)));
         let rev = opts.rev;

         if (!metadata)
            return callback(createError(MISSING_DOC, "missing"));

         // Pick the latest revision.
         if (opts.latest)
            rev = metadata.rev;

         // Otherwise, if revision is not given, get the winning revision from metadata.
         // TODO: figure out what the winning rev is and if this works correctly here.
         else if (!rev)
            rev = getWinningRev(metadata);

         // Verify that revision is not deleted.
         if (isDeleted(metadata, rev))
            return callback(createError(MISSING_DOC, "deleted"));

         const seq = metadata.rev_map && metadata.rev_map[rev];

         // Verify that revision map is not corrupted.
         if (!seq)
            return callback(createError(INVALID_REV, "corrupted"));

         const doc = safeJsonParse(db.getStr(bySequence(seq)));

         // Verify that data exists.
         if (!doc)
            return callback(createError(MISSING_DOC, "missing"));

         // Decorate document with ID and revision from metadata.
         doc._id = metadata.id;
         doc._rev = rev;

         callback(null, doc);
      },

      function _allDocs(opts, callback) {
         // TODO: support opts.conflicts
         // TODO: support opts.attachment
         // TODO: support opts.binary
         // TODO: support opts.descending

         const handler = use();
         const iter = handler.db.newIterator();

         // If the key option is defined, override keys option with a singular key.
         if (opts.key)
            opts.keys = [opts.key];

         try {
            // Seek the iterator to start key position.
            iter.seek(documentStore(opts.startKey));

            const skip = opts.skip ?? 0;

            // Advance iterator number of skips.
            for (let i = 0; i < skip; ++i)
               iter.next();

            const rows = [];
            const keyToRowMap = new Map();

            // Iterate the rows until
            //  - iterator is valid;
            //  - keys are within document store namespace;
            //  - limit is not reached;
            //  - end key is not reached.
            for (let i = 0; iter.valid() && iter.keyStr().startsWith(documentStore()) && (opts.limit === undefined || i < opts.limit); iter.next(), ++i) {
               const stop = iter.keyStr() === documentStore(opts.endKey);

               // Stop early if end is exclusive.
               if (stop && opts.inclusive_end === false)
                  break;

               const metadata = safeJsonParse(iter.valueStr());
               const rev = metadata.rev; // TODO: use winning rev?

               const row = {
                  id: metadata.id,
                  key: metadata.id,
                  value: { rev },
               };

               if (isDeleted(metadata, rev))
                  row.value.deleted = true;

               // Do not include deleted documents unless keys are specified.
               if (!row.value.deleted || opts.keys) {
                  if (opts.include_docs) {

                     // Set document data to null if it is deleted.
                     if (row.value.deleted)
                        row.doc = null;

                     // Otherwise, retrieve data from database.
                     else {
                        const seq = metadata.rev_map[rev];

                        row.doc = safeJsonParse(handler.db.getStr(bySequence(seq)));
                     }
                  }

                  keyToRowMap.set(row.key, rows.length);
                  rows.push(row);
               }

               // Handle inclusive end stop.
               if (stop)
                  break;
            }

            const result = {
               offset: skip,
               total_rows: handler.docCount,
            };

            if (opts.update_seq)
               result.update_seq = handler.updateSeq;

            // Re-order rows to match the ordering in keys array.
            if (opts.keys)
               result.rows = opts.keys.map(x => rows[keyToRowMap.get(x)] ?? createError(MISSING_DOC));

            // Otherwise, use rows as-is.
            else
               result.rows = rows;

            callback(null, result);
         }
         finally {
            iter.close();
         }
      },

      function _getRevisionTree(docId, callback) {
         const { db } = use();
         const { rev_tree } = safeJsonParse(db.getStr(documentStore(docId)));

         callback(null, rev_tree);
      },

      function _close(callback) {
         const { db } = use();

         db.close();
         RNLevelDBAdapter.Handlers.delete(databaseName);

         callback();
      },

      function _destroy(callback) {
         this._close(() => {
            destroyLevelDatabase(databaseName);
            callback();
         });
      },
   );

   const db = new LevelDB(databaseName, true, false);

   try {
      const [docCount, updateSeq] = new Uint32Array(db.getBuf(metaStore(docCountUpdateSeqKey())) ?? [0, 0]);

      RNLevelDBAdapter.Handlers.set(databaseName, {
         docCount,
         updateSeq,
         db,
      });

      callback(null, this);
   }
   catch (e) {
      RNLevelDBAdapter.Handlers.delete(databaseName);
      db.close();
      callback(e);
   }
}

RNLevelDBAdapter.Handlers = new Map();

RNLevelDBAdapter.use_prefix = false;

RNLevelDBAdapter.valid = function() {
   return true;
}

module.exports = function(PouchDB) {
   PouchDB.adapter("react-native-leveldb", RNLevelDBAdapter, true);
};
