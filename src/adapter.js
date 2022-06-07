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

function nextTick(f) {
   return (...args) => {
      setTimeout(() => f.apply(this, args), 0);
   };
}

function safeApiCall(functionWithCallback, ...args) {
   const { length, [length - 1]: callback } = args;

   try {
      functionWithCallback.apply(this, args);
   }
   catch (e) {
      if (["PouchError", "CustomPouchError"].indexOf(e.constructor?.name) >= 0)
         callback(e);
      else
         throw e;
   }
}

function makeApi(self, ...methods) {
   for (let i = 0; i < methods.length; ++i)
      self[methods[i].name] = safeApiCall.bind(self, methods[i]);
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

   function getJson(key) {
      const { db } = use();
      const value = safeJsonParse(db.getStr(key));

      if (!value)
         throw createError(MISSING_DOC, "missing");

      return value;
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
         const docs = req.docs.map(x => parseDoc(x, opts.new_edits !== false, this.__opts));
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

         const metadata = getJson(documentStore(id));
         let rev = opts.rev;

         // If revision is not given, get the winning rev from metadata.
         if (!rev) {
            rev = getWinningRev(metadata);

            if (isDeleted(metadata, rev))
               throw createError(MISSING_DOC, "deleted");
         }

         // Otherwise, get the latest revision if requested.
         else if (opts.latest)
            rev = getLatest(rev, metadata);

         const doc = getJson(bySequence(metadata.rev_map[rev]));

         // Verify that document ID is not corrupted.
         if (doc._id && doc._id !== metadata.id)
            throw createError(MISSING_DOC, "id");

         // Verify that document revision is not corrupted.
         if (doc._rev && doc._rev !== rev)
            throw createError(MISSING_DOC, "revision");

         // Set ID and revision to match with metadata.
         doc._id = metadata.id;
         doc._rev = rev;

         callback(null, doc);
      },

      function _allDocs(opts, callback) {
         // TODO: support opts.conflicts
         // TODO: support opts.attachment
         // TODO: support opts.binary
         // TODO: support opts.descending
         // TODO: support opts.keys
         // TODO: support opts.key

         const { db, docCount, updateSeq } = use();
         const iter = db.newIterator();

         try {
            const skip = opts.skip ?? 0;

            // Seek iterator to start key position.
            iter.seek(documentStore(opts.startKey));

            // Advance iterator number of skips.
            for (let i = 0; i < skip; ++i)
               iter.next();

            const rows = [];

            for (let i = 0; iter.valid() && (opts.limit === undefined || i < opts.limit); iter.next(), ++i) {
               const stop = iter.keyStr() === documentStore(opts.endKey);

               // Stop early if end is exclusive.
               if (stop && opts.inclusive_end === false)
                  break;

               const metadata = safeJsonParse(iter.valueStr());
               const rev = getWinningRev(metadata);
               const docDeleted = isDeleted(metadata, rev);

               const row = {
                  id: metadata.id,
                  key: metadata.id,
                  value: { rev },
               };

               if (!docDeleted || opts.deleted === "ok") {
                  if (docDeleted) {
                     row.value.deleted = true;

                     if (opts.include_docs)
                        row.doc = null;
                  }
                  else if (opts.include_docs)
                     row.doc = getJson(bySequence(metadata.rev_map[rev]));

                  rows.push(row);
               }

               if (stop)
                  break;
            }

            const result = {
               rows,
               offset: skip,
               total_rows: docCount,
            };

            if (opts.update_seq)
               result.update_seq = updateSeq;

            callback(null, result);
         }
         finally {
            iter.close();
         }
      },

      function _getRevisionTree(docId, callback) {
         const { rev_tree } = getJson(documentStore(docId));

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

      // TODO: support attachments
   );

   safeApiCall(callback => {
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
         throw e;
      }
   }, callback);
}

RNLevelDBAdapter.Handlers = new Map();

RNLevelDBAdapter.use_prefix = false;

RNLevelDBAdapter.valid = function() {
   return true;
}

module.exports = function(PouchDB) {
   PouchDB.adapter("react-native-leveldb", RNLevelDBAdapter, true);
};
