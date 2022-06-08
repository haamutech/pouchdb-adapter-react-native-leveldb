const install = require("../../src/adapter");
const { spyLevelDBConstructor, LevelDB, destroyLevelDatabase } = require("../../src/backend");
const { pad16 } = require("../../src/utils");

const {
   safeJsonParse,
   safeJsonStringify,
} = require("pouchdb-json");

const {
   MISSING_DOC,
   createError,
} = require("pouchdb-errors");

jest.mock("../../src/backend", () => {
   const { FakeLevelDB } = jest.requireActual("react-native-leveldb/lib/commonjs/fake");
   const spyLevelDBConstructor = jest.fn();

   class MockLevelDB extends FakeLevelDB {
      constructor(...args) {
         super(...args);
         spyLevelDBConstructor(...args);
      }
   }

   return {
      spyLevelDBConstructor,
      destroyLevelDatabase: jest.fn(),
      LevelDB: MockLevelDB,
   };
});

it("installs adapter", () => {
   const PouchDB = {
      adapter: jest.fn(),
   };

   install(PouchDB);

   expect(PouchDB.adapter).toHaveBeenCalledTimes(1);
   expect(PouchDB.adapter).toHaveBeenCalledWith(
      "react-native-leveldb",
      expect.anything(),
      true,
   );
});

describe("RNLevelDBAdapter", () => {
   let Adapter = null;

   beforeEach(() => {
      const PouchDB = {
         adapter: jest.fn(),
      };

      install(PouchDB);

      Adapter = PouchDB.adapter.mock.calls[0][1];

      global.localStorage = {
         length: 0,
      };
   });

   function promisify(functionWithCallback, ...args) {
      return new Promise((resolve, reject) => {
         functionWithCallback(...args, (error, ...values) => {
            if (error)
               reject(error);
            else
               resolve(values);
         });
      });
   }

   async function createAdapter(name) {
      const instance = {};

      await promisify(Adapter.bind(instance), { name });

      return instance;
   }

   it("does not use prefix", () => {
      expect(Adapter.use_prefix).toBe(false);
   });

   it("is valid", () => {
      expect(Adapter.valid()).toBe(true);
   });

   describe("RNLevelDBAdapter", () => {
      const name = "dbname";
      const databaseName = `${name}.db`;

      it("opens a database", async () => {
         await createAdapter(name);

         expect(spyLevelDBConstructor).toHaveBeenCalledWith(databaseName, true, false);
      });

      it("fails to open a database", async () => {
         const name = "dbname";
         const close = jest.spyOn(LevelDB.prototype, "close");

         await expect(new Promise((_, reject) => {
            Adapter.call({}, { name }, error => {
               if (!error)
                  throw new Error("ball");

               reject(error);
            });
         })).rejects.toThrow("ball");

         expect(Adapter.Handlers.has(`${name}.db`)).toBe(false);
         expect(close).toHaveBeenCalledTimes(1);
      });

      it("reads doc_count and update_seq bookkeeping values", async () => {
         const getBuf = jest.spyOn(LevelDB.prototype, "getBuf");

         await createAdapter(name);

         expect(getBuf).toHaveBeenCalledWith("meta-store/doc_count+update_seq");
      });

      it("creates a database handler and initializes bookkeeping values", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValue([3, 42]);

         await createAdapter(name);

         expect(Adapter.Handlers.has(databaseName)).toBe(true);

         const handler = Adapter.Handlers.get(databaseName);

         expect(handler.docCount).toBe(3);
         expect(handler.updateSeq).toBe(42);
         expect(handler.db.constructor.name).toBe("MockLevelDB");
      });
   });

   describe("_info", () => {
      it("returns info structure", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValue([42, 3]);

         const adapter = await createAdapter();
         const [value] = await promisify(adapter._info);

         expect(value).toEqual({
            doc_count: 42,
            update_seq: 3,
         });
      });
   });

   describe("_getRevisionTree", () => {
      const rev_tree = {
         revision: 2,
      };

      it("returns revision tree for a document", async () => {
         const getStr = jest
            .spyOn(LevelDB.prototype, "getStr")
            .mockReturnValue(safeJsonStringify({ rev_tree }));

         const adapter = await createAdapter();
         const docId = "doc-id-1";

         const [value] = await promisify(adapter._getRevisionTree, docId);

         expect(getStr).toHaveBeenCalledWith(`document-store/${docId}`);
         expect(value).toEqual(rev_tree);
      });
   });

   describe("_close", () => {
      const name = "dbname";
      const databaseName = `${name}.db`;

      it("closes the database", async () => {
         const close = jest.spyOn(LevelDB.prototype, "close");

         const adapter = await createAdapter(name);

         await promisify(adapter._close);

         expect(close).toHaveBeenCalled();
      });

      it("removes the handler", async () => {
         const adapter = await createAdapter(name);

         await promisify(adapter._close);

         expect(Adapter.Handlers.has(databaseName)).toBe(false);
      });

      it("fails if database is not open", async () => {
         const adapter = await createAdapter(name);

         await promisify(adapter._close);
         await expect(promisify(adapter._close)).rejects.toThrow("not open");
      });
   });

   describe("_destroy", () => {
      const name = "dbname";
      const databaseName = `${name}.db`;

      it("closes the database", async () => {
         const adapter = await createAdapter(name);

         adapter._close = jest.fn().mockImplementation(callback => callback());

         await promisify(adapter._destroy);

         expect(adapter._close).toHaveBeenCalled();
      });

      it("destroys the database", async () => {
         const adapter = await createAdapter(name);

         adapter._close = jest.fn().mockImplementation(callback => callback());

         await promisify(adapter._destroy);

         expect(destroyLevelDatabase).toHaveBeenCalledWith(databaseName);
      });
   });

   describe("_bulkDocs", () => {
      it("fails if docs list is missing", async () => {
         const adapter = await createAdapter();

         await expect(promisify(adapter._bulkDocs, {}, {})).rejects.toThrow("Missing JSON list of 'docs'");
      });

      it("inserts new document", async () => {
         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const doc = {
            _id: "doc-id-1",
            key: "value",
         };

         const put = jest.spyOn(db, "put");

         const [[value]] = await promisify(adapter._bulkDocs, { docs: [doc] }, {});

         const { docCount, updateSeq } = Adapter.Handlers.get();

         const metadata = safeJsonParse(db.getStr(`document-store/${doc._id}`));
         const seq = metadata.rev_map[metadata.rev];

         const data = safeJsonParse(db.getStr(`by-sequence/${pad16(seq)}`));

         const bookkeeping = db.getBuf("meta-store/doc_count+update_seq");

         expect(value).toEqual({
            ok: true,
            id: metadata.id,
            rev: metadata.rev,
         });

         expect(metadata).toEqual({
            id: "doc-id-1",
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available",
                     },
                     [],
                  ],
               },
            ],
            rev: "1-ff002d9c0442a077f8d349f04fb61113",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
            },
         });

         expect(data).toEqual({
            key: "value",
         });

         expect(updateSeq).toBe(seq);
         expect(docCount).toBe(1);

         expect(bookkeeping).toEqual(Uint32Array.of(docCount, updateSeq).buffer);

         expect(put.mock.calls).toEqual([
            [`document-store/${doc._id}`, expect.anything()],
            [`by-sequence/${pad16(seq)}`, expect.anything()],
            ["meta-store/doc_count+update_seq", expect.anything()],
         ]);
      });

      it("rolls back insert on error", async () => {
         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const doc = {
            _id: "doc-id-1",
            key: "value",
         };

         {
            const actualPut = db.put;

            db.put = jest.fn((k, v) => {
               if (k === "meta-store/doc_count+update_seq")
                  throw new Error("ball");

               return actualPut.call(db, k, v);
            });
         }

         const del = jest.spyOn(db, "delete");

         const [[value]] = await promisify(adapter._bulkDocs, { docs: [doc] }, {});

         expect(value.message).toEqual("ball");

         const metadata = db.getStr(`document-store/${doc._id}`);

         expect(metadata).toBe(null);

         const data = safeJsonParse(db.getStr(`by-sequence/${pad16(1)}`));

         expect(data).toBe(null);

         const { docCount, updateSeq } = Adapter.Handlers.get();

         expect(updateSeq).toBe(0);
         expect(docCount).toBe(0);

         expect(del.mock.calls).toEqual([
            [`document-store/${doc._id}`],
            [`by-sequence/${pad16(1)}`],
         ]);
      });

      it("replaces existing document", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValueOnce([1, 1]);

         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const doc = {
            _id: "doc-id-1",
            key2: "value2",
         };

         db.put(`document-store/${doc._id}`, safeJsonStringify({
            id: doc._id,
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available",
                     },
                     [],
                  ],
               },
            ],
            rev: "1-ff002d9c0442a077f8d349f04fb61113",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
            },
         }));

         db.put(`by-sequence/${pad16(1)}`, safeJsonStringify({
            key: "value",
         }));

         const put = jest.spyOn(db, "put");

         const [[value]] = await promisify(adapter._bulkDocs, { docs: [doc] }, {});

         const metadata = safeJsonParse(db.getStr(`document-store/${doc._id}`));

         expect(metadata).toEqual({
            id: "doc-id-1",
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
               {
                  pos: 1,
                  ids: [
                     "08758510f84820b60dbaa16e642fcf8b",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
            ],
            rev: "1-08758510f84820b60dbaa16e642fcf8b",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
               "1-08758510f84820b60dbaa16e642fcf8b": 2,
            },
         });

         expect(value).toEqual({
            ok: true,
            id: metadata.id,
            rev: metadata.rev,
         });

         const seq = metadata.rev_map[metadata.rev];
         const data = safeJsonParse(db.getStr(`by-sequence/${pad16(metadata.rev_map[metadata.rev])}`));

         expect(data).toEqual({
            key2: "value2",
         });

         const bookkeeping = db.getBuf("meta-store/doc_count+update_seq");
         const { docCount, updateSeq } = Adapter.Handlers.get();

         expect(updateSeq).toBe(seq);
         expect(docCount).toBe(1);

         expect(bookkeeping).toEqual(Uint32Array.of(docCount, updateSeq).buffer);

         expect(put.mock.calls).toEqual([
            [`document-store/${doc._id}`, expect.anything()],
            [`by-sequence/${pad16(seq)}`, expect.anything()],
            ["meta-store/doc_count+update_seq", expect.anything()],
         ]);
      });

      it("rolls back document replacement on error", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValueOnce([1, 1]);

         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const doc = {
            _id: "doc-id-1",
            key2: "value2",
         };

         const originalMetadata = {
            id: doc._id,
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available",
                     },
                     [],
                  ],
               },
            ],
            rev: "1-ff002d9c0442a077f8d349f04fb61113",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
            },
         };

         db.put(`document-store/${doc._id}`, safeJsonStringify(originalMetadata));

         const originalData = {
            key: "value",
         };

         db.put(`by-sequence/${pad16(1)}`, safeJsonStringify(originalData));

         {
            const actualPut = db.put;

            db.put = jest.fn((k, v) => {
               if (k === "meta-store/doc_count+update_seq")
                  throw new Error("ball");

               return actualPut.call(db, k, v);
            });
         }

         const del = jest.spyOn(db, "delete");

         const [[value]] = await promisify(adapter._bulkDocs, { docs: [doc] }, {});

         expect(value.message).toEqual("ball");

         const metadata = safeJsonParse(db.getStr(`document-store/${doc._id}`));

         expect(metadata).toEqual(originalMetadata);

         const { docCount, updateSeq } = Adapter.Handlers.get();

         expect(updateSeq).toBe(1);
         expect(docCount).toBe(1);

         expect(del.mock.calls).toEqual([
            [`by-sequence/${pad16(2)}`],
         ]);
      });

      it("deletes existing document", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValueOnce([1, 1]);

         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const doc = {
            _id: "doc-id-1",
            _deleted: true,
         };

         db.put(`document-store/${doc._id}`, safeJsonStringify({
            id: doc._id,
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available",
                     },
                     [],
                  ],
               },
            ],
            rev: "1-ff002d9c0442a077f8d349f04fb61113",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
            },
         }));

         db.put(`by-sequence/${pad16(1)}`, {
            key: "value",
         });

         const put = jest.spyOn(db, "put");

         const [[value]] = await promisify(adapter._bulkDocs, { docs: [doc] }, {});

         const metadata = safeJsonParse(db.getStr(`document-store/${doc._id}`));

         expect(metadata).toEqual({
            id: "doc-id-1",
            deleted: true,
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
               {
                  pos: 1,
                  ids: [
                     "2ab15399e3f54a4ef2cd60bf7867c30c",
                     {
                        status: "available",
                        deleted: true
                     },
                     [],
                  ],
               },
            ],
            rev: "1-2ab15399e3f54a4ef2cd60bf7867c30c",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
               "1-2ab15399e3f54a4ef2cd60bf7867c30c": 2,
            },
         });

         const seq = metadata.rev_map[metadata.rev];
         const data = db.getStr(`by-sequence/${pad16(seq)}`);

         expect(data).toBe(null);

         expect(value).toEqual({
            ok: true,
            id: metadata.id,
            rev: metadata.rev,
         });

         const bookkeeping = db.getBuf("meta-store/doc_count+update_seq");
         const { docCount, updateSeq } = Adapter.Handlers.get();

         expect(updateSeq).toBe(seq);
         expect(docCount).toBe(0);

         expect(bookkeeping).toEqual(Uint32Array.of(docCount, updateSeq).buffer);

         expect(put.mock.calls).toEqual([
            [`document-store/${doc._id}`, expect.anything()],
            ["meta-store/doc_count+update_seq", expect.anything()],
         ]);
      });
   });

   describe("_get", () => {
      it("cannot retrieve non-existing document", async () => {
         const adapter = await createAdapter();

         await expect(promisify(adapter._get, "doc-id", {})).rejects.toThrow("missing");
      });

      it("retrieves a specific document revision", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValueOnce([1, 2]);

         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const docId = "doc-id-1";
         const rev = "1-ff002d9c0442a077f8d349f04fb61113";

         db.put(`document-store/${docId}`, safeJsonStringify({
            id: docId,
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
               {
                  pos: 1,
                  ids: [
                     "08758510f84820b60dbaa16e642fcf8b",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
            ],
            rev: "1-08758510f84820b60dbaa16e642fcf8b",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
               "1-08758510f84820b60dbaa16e642fcf8b": 2,
            },
         }));

         db.put(`by-sequence/${pad16(1)}`, safeJsonStringify({
            key: "value",
         }));

         db.put(`by-sequence/${pad16(2)}`, safeJsonStringify({
            key2: "value2",
         }));

         const [value] = await promisify(adapter._get, docId, { rev });

         const metadata = safeJsonParse(db.getStr(`document-store/${docId}`));

         expect(value).toEqual({
            doc: {
               _id: docId,
               _rev: rev,
               key: "value",
            },
            metadata,
         });
      });

      it("retrieves latest document revision", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValueOnce([1, 2]);

         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const docId = "doc-id-1";
         const rev = "1-08758510f84820b60dbaa16e642fcf8b";

         db.put(`document-store/${docId}`, safeJsonStringify({
            id: docId,
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
               {
                  pos: 1,
                  ids: [
                     "08758510f84820b60dbaa16e642fcf8b",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
            ],
            rev: "1-08758510f84820b60dbaa16e642fcf8b",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
               "1-08758510f84820b60dbaa16e642fcf8b": 2,
            },
         }));

         db.put(`by-sequence/${pad16(1)}`, safeJsonStringify({
            key: "value",
         }));

         db.put(`by-sequence/${pad16(2)}`, safeJsonStringify({
            key2: "value2",
         }));

         const [value] = await promisify(adapter._get, docId, { latest: true });

         const metadata = safeJsonParse(db.getStr(`document-store/${docId}`));

         expect(value).toEqual({
            doc: {
               _id: docId,
               _rev: rev,
               key2: "value2",
            },
            metadata
         });
      });

      it("fails to retrieve a deleted document revision", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValueOnce([1, 2]);

         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const docId = "doc-id-1";
         const rev = "1-2ab15399e3f54a4ef2cd60bf7867c30c";

         db.put(`document-store/${docId}`, safeJsonStringify({
            id: "doc-id-1",
            deleted: true,
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
               {
                  pos: 1,
                  ids: [
                     "2ab15399e3f54a4ef2cd60bf7867c30c",
                     {
                        status: "available",
                        deleted: true
                     },
                     [],
                  ],
               },
            ],
            rev: "1-2ab15399e3f54a4ef2cd60bf7867c30c",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
               "1-2ab15399e3f54a4ef2cd60bf7867c30c": 2,
            },
         }));

         await expect(promisify(adapter._get, docId, { rev })).rejects.toThrow("missing");
      });

      it("fails to retrieve if document revision map is corrupted", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValueOnce([1, 2]);

         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const docId = "doc-id-1";
         const rev = "1-2ab15399e3f54a4ef2cd60bf7867c30c";

         db.put(`document-store/${docId}`, safeJsonStringify({
            id: "doc-id-1",
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
               {
                  pos: 1,
                  ids: [
                     "2ab15399e3f54a4ef2cd60bf7867c30c",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
            ],
            rev: "1-2ab15399e3f54a4ef2cd60bf7867c30c",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
            },
         }));

         await expect(promisify(adapter._get, docId, { rev })).rejects.toThrow("Invalid rev format");
      });

      it("fails to retrieve document with missing data", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValueOnce([1, 2]);

         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const docId = "doc-id-1";
         const rev = "1-2ab15399e3f54a4ef2cd60bf7867c30c";

         db.put(`document-store/${docId}`, safeJsonStringify({
            id: "doc-id-1",
            rev_tree: [
               {
                  pos: 1,
                  ids: [
                     "ff002d9c0442a077f8d349f04fb61113",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
               {
                  pos: 1,
                  ids: [
                     "2ab15399e3f54a4ef2cd60bf7867c30c",
                     {
                        status: "available"
                     },
                     [],
                  ],
               },
            ],
            rev: "1-2ab15399e3f54a4ef2cd60bf7867c30c",
            rev_map: {
               "1-ff002d9c0442a077f8d349f04fb61113": 1,
               "1-2ab15399e3f54a4ef2cd60bf7867c30c": 2,
            },
         }));

         await expect(promisify(adapter._get, docId, { rev })).rejects.toThrow("missing");
      });
   });

   describe("_allDocs", () => {
      it("iterates all rows", async () => {
         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const docs = [
            { _id: "doc-id-1", key: "value" },
            { _id: "doc-id-2", key2: "value2" },
            { _id: "doc-id-3", key3: "value3" },
         ];

         const [values] = await promisify(adapter._bulkDocs, { docs }, {});

         expect(values.every(x => x.ok)).toBe(true);

         const metadatas = docs.map(x => safeJsonParse(db.getStr(`document-store/${x._id}`)));

         const [result] = await promisify(adapter._allDocs, {});

         expect(result).toEqual({
            offset: 0,
            total_rows: docs.length,
            rows: docs.map((x, i) => ({
               id: x._id,
               key: x._id,
               value: {
                  rev: metadatas[i].rev
               },
            })),
         });
      });

      it("returns update_seq if requested", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockReturnValueOnce([0, 42]);

         const adapter = await createAdapter();

         const [result] = await promisify(adapter._allDocs, { update_seq: true });

         expect(result).toEqual({
            offset: 0,
            total_rows: 0,
            update_seq: 42,
            rows: [],
         });
      });

      it("closes the iterator", async () => {
         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         let close;

         {
            const originalNewIterator = db.newIterator;

            db.newIterator = () => {
               const iterator = originalNewIterator.call(db);

               close = jest.spyOn(iterator, "close");

               return iterator;
            };
         }

         await promisify(adapter._allDocs, { update_seq: true });

         expect(close).toHaveBeenCalledTimes(1);
      });

      it("closes the iterator on error", async () => {
         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         let close;

         {
            const originalNewIterator = db.newIterator;

            db.newIterator = () => {
               const iterator = originalNewIterator.call(db);

               jest.spyOn(iterator, "seek").mockImplementation(() => { throw new Error("ball"); });

               close = jest.spyOn(iterator, "close");

               return iterator;
            };
         }

         await expect(promisify(adapter._allDocs, { update_seq: true })).rejects.toThrow("ball");

         expect(close).toHaveBeenCalledTimes(1);
      });

      it("skips rows", async () => {
         const adapter = await createAdapter();

         const docs = [
            { _id: "doc-id-1", key: "value" },
            { _id: "doc-id-2", key2: "value2" },
            { _id: "doc-id-3", key3: "value3" },
         ];

         const skip = 2;

         const [values] = await promisify(adapter._bulkDocs, { docs }, {});

         expect(values.every(x => x.ok)).toBe(true);

         const [result] = await promisify(adapter._allDocs, { skip });

         expect(result).toEqual({
            offset: skip,
            total_rows: docs.length,
            rows: docs.slice(skip).map(x => ({
               id: x._id,
               key: x._id,
               value: expect.anything(),
            })),
         });
      });

      it("stops iterating when end key is reached", async () => {
         const adapter = await createAdapter();

         const docs = [
            { _id: "doc-id-1", key: "value" },
            { _id: "doc-id-2", key2: "value2" },
            { _id: "doc-id-3", key3: "value3" },
         ];

         const endKey = "doc-id-2";

         const [values] = await promisify(adapter._bulkDocs, { docs }, {});

         expect(values.every(x => x.ok)).toBe(true);

         const [result] = await promisify(adapter._allDocs, { endKey });

         expect(result).toEqual({
            offset: 0,
            total_rows: docs.length,
            rows: docs.slice(0, docs.length - 1).map(x => ({
               id: x._id,
               key: x._id,
               value: expect.anything(),
            })),
         });
      });

      it("stops iterating before end key is reached", async () => {
         const adapter = await createAdapter();

         const docs = [
            { _id: "doc-id-1", key: "value" },
            { _id: "doc-id-2", key2: "value2" },
            { _id: "doc-id-3", key3: "value3" },
         ];

         const endKey = "doc-id-2";

         const [values] = await promisify(adapter._bulkDocs, { docs }, {});

         expect(values.every(x => x.ok)).toBe(true);

         const [result] = await promisify(adapter._allDocs, { endKey, inclusive_end: false });

         expect(result).toEqual({
            offset: 0,
            total_rows: docs.length,
            rows: docs.slice(0, docs.length - 2).map(x => ({
               id: x._id,
               key: x._id,
               value: expect.anything(),
            })),
         });
      });

      it("starts iterating from start key", async () => {
         const adapter = await createAdapter();

         const docs = [
            { _id: "doc-id-1", key: "value" },
            { _id: "doc-id-2", key2: "value2" },
            { _id: "doc-id-3", key3: "value3" },
         ];

         const startKey = "doc-id-2";

         const [values] = await promisify(adapter._bulkDocs, { docs }, {});

         expect(values.every(x => x.ok)).toBe(true);

         const [result] = await promisify(adapter._allDocs, { startKey });

         expect(result).toEqual({
            offset: 0,
            total_rows: docs.length,
            rows: docs.slice(1).map(x => ({
               id: x._id,
               key: x._id,
               value: expect.anything(),
            })),
         });
      });

      it("includes only selected keys", async () => {
         const adapter = await createAdapter();

         const docs = [
            { _id: "doc-id-1", key: "value" },
            { _id: "doc-id-2", key2: "value2" },
            { _id: "doc-id-3", key3: "value3" },
         ];

         const keys = [docs[2]._id, docs[1]._id];

         const [values] = await promisify(adapter._bulkDocs, { docs }, {});

         expect(values.every(x => x.ok)).toBe(true);

         const [result] = await promisify(adapter._allDocs, { keys });

         expect(result).toEqual({
            offset: 0,
            total_rows: docs.length,
            rows: keys.map(x => ({
               id: x,
               key: x,
               value: {
                  rev: expect.anything(),
               },
            })),
         });
      });

      it("includes deleted documents if explicitly requested via keys", async () => {
         const adapter = await createAdapter();

         const docs = [
            { _id: "doc-id-1", key: "value" },
            { _id: "doc-id-2", key2: "value2" },
            { _id: "doc-id-3", key3: "value3" },
         ];

         const deletedDoc = {
            _id: docs[1]._id,
            _deleted: true
         };

         const [values1] = await promisify(adapter._bulkDocs, { docs }, {});

         expect(values1.every(x => x.ok)).toBe(true);

         const [values2] = await promisify(adapter._bulkDocs, { docs: [deletedDoc] }, {});

         expect(values2.every(x => x.ok)).toBe(true);

         const [result] = await promisify(adapter._allDocs, { keys: [deletedDoc._id] });

         expect(result).toEqual({
            offset: 0,
            total_rows: docs.length - 1,
            rows: [deletedDoc].map(x => ({
               id: x._id,
               key: x._id,
               value: {
                  rev: expect.anything(),
                  deleted: true,
               },
            })),
         });
      });

      it("includes a selected key", async () => {
         const adapter = await createAdapter();

         const docs = [
            { _id: "doc-id-1", key: "value" },
            { _id: "doc-id-2", key2: "value2" },
            { _id: "doc-id-3", key3: "value3" },
         ];

         const key = docs[1]._id;

         const [values] = await promisify(adapter._bulkDocs, { docs }, {});

         expect(values.every(x => x.ok)).toBe(true);

         const [result] = await promisify(adapter._allDocs, { key });

         expect(result).toEqual({
            offset: 0,
            total_rows: docs.length,
            rows: [
               {
                  id: key,
                  key: key,
                  value: {
                     rev: expect.anything(),
                  },
               },
            ],
         });
      });

      it("includes data when requested", async () => {
         const adapter = await createAdapter();

         const docs = [
            { _id: "doc-id-1", key: "value" },
            { _id: "doc-id-2", key2: "value2" },
            { _id: "doc-id-3", key3: "value3" },
         ];

         const [values] = await promisify(adapter._bulkDocs, { docs }, {});

         expect(values.every(x => x.ok)).toBe(true);

         const [result] = await promisify(adapter._allDocs, { include_docs: true });

         expect(result).toEqual({
            offset: 0,
            total_rows: docs.length,
            rows: docs.map(x => {
               const doc = { ...x };
               delete doc._id;

               return {
                  id: x._id,
                  key: x._id,
                  value: {
                     rev: expect.anything(),
                  },
                  doc,
               };
            }),
         });
      });

      it("includes null data when requested if deleted", async () => {
         const adapter = await createAdapter();

         const doc = {
            _id: "doc-id-1",
            key: "value"
         };

         const [values1] = await promisify(adapter._bulkDocs, { docs: [doc] }, {});

         expect(values1.every(x => x.ok)).toBe(true);

         const [values2] = await promisify(adapter._bulkDocs, { docs: [{ _id: doc._id, _deleted: true }] }, {});

         expect(values2.every(x => x.ok)).toBe(true);

         const [result] = await promisify(adapter._allDocs, { key: doc._id, include_docs: true });

         expect(result).toEqual({
            offset: 0,
            total_rows: 0,
            rows: [
               {
                  id: doc._id,
                  key: doc._id,
                  value: {
                     rev: expect.anything(),
                     deleted: true,
                  },
                  doc: null
               },
            ],
         });
      });
   });
});
