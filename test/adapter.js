const install = require("../src/adapter");
const { spyLevelDBConstructor, LevelDB, destroyLevelDatabase } = require("../src/backend");
const { pad16 } = require("../src/utils");

const {
   safeJsonParse,
   safeJsonStringify
} = require("pouchdb-json");

jest.mock("../src/backend", () => {
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

      it("reads doc_count and update_seq bookkeeping values", async () => {
         const getBuf = jest.spyOn(LevelDB.prototype, "getBuf");

         await createAdapter(name);

         expect(getBuf).toHaveBeenCalledWith("meta-store/doc_count+update_seq");
      });

      it("creates a database handler", async () => {
         await createAdapter(name);

         expect(Adapter.Handlers.has(databaseName)).toBe(true);

         const handler = Adapter.Handlers.get(databaseName);

         expect(handler.docCount).toBe(0);
         expect(handler.updateSeq).toBe(0);
         expect(handler.db.constructor.name).toBe("MockLevelDB");
      });
   });

   describe("_info", () => {
      it("returns info structure", async () => {
         jest.spyOn(LevelDB.prototype, "getBuf").mockImplementation(() => [42, 3]);

         const adapter = await createAdapter();
         const [value] = await promisify(adapter._info);

         expect(value).toEqual({
            docCount: 42,
            updateSeq: 3,
            backend_adapter: "react-native-leveldb",
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

   describe("_put", () => {
      it("requires document _id", async () => {
         const adapter = await createAdapter();
         const doc = {};

         await expect(promisify(adapter._put, doc, {})).rejects.toThrow("_id is required for puts");
      });

      it("inserts new document", async () => {
         const adapter = await createAdapter();

         const doc = {
            _id: "doc-id-1",
            key: "value",
         };

         adapter._get = jest
            .fn()
            .mockImplementation((id, opts, callback) => callback(new Error(), null));

         const [value] = await promisify(adapter._put, doc, {});

         expect(adapter._get).toHaveBeenCalled();

         const { docCount, updateSeq, db } = Adapter.Handlers.get();

         const metadata = safeJsonParse(db.getStr(`document-store/${doc._id}`));
         const seq = metadata.rev_map[metadata.rev];

         const data = safeJsonParse(db.getStr(`by-sequence/${pad16(seq)}`));

         expect(value).toEqual({
            ok: true,
            id: metadata.id,
            rev: metadata.rev,
         });

         expect(data).toEqual({
            key: "value",
         });

         expect(updateSeq).toBe(seq);
         expect(docCount).toBe(1);
      });

      it("requires that document to be deleted exists", async () => {
         const adapter = await createAdapter();

         const doc = {
            _id: "doc-id-1",
            _deleted: true
         };

         adapter._get = jest
            .fn()
            .mockImplementation((id, opts, callback) => callback(new Error(), null));

         await expect(promisify(adapter._put, doc, {})).rejects.toThrow("missing");

         const { docCount, updateSeq } = Adapter.Handlers.get();

         expect(updateSeq).toBe(0);
         expect(docCount).toBe(0);
      });
   });

   /*describe("_get", () => {
      it("retrieves a specific document and revision", async () => {
         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const rev = "some rev";
         const id = "document-id";
         const seq = "0000000000000000";

         const metadata = {
            id,
            rev,
            rev_map: {
               [rev]: seq
            }
         };

         const data = {
            _id: id,
            _rev: rev,
            key: "value",
         };

         db.put(`document-store/${id}`, safeJsonStringify(metadata));
         db.put(`by-sequence/${seq}`, safeJsonStringify(data));

         const [result] = await promisify(adapter._get, id, { rev });

         expect(result.doc).toEqual(data);
         expect(result.metadata).toEqual(metadata);
      });

      it("retrieves latest revision of a document", async () => {
         const adapter = await createAdapter();
         const { db } = Adapter.Handlers.get();

         const rev = "some rev";
         const id = "document-id";
         const seq = "0000000000000000";

         const metadata = {
            id,
            rev,
            rev_map: {
               [rev]: seq
            }
         };

         const data = {
            _id: id,
            _rev: rev,
            key: "value",
         };

         db.put(`document-store/${id}`, safeJsonStringify(metadata));
         db.put(`by-sequence/${seq}`, safeJsonStringify(data));

         const [result] = await promisify(adapter._get, id, { rev });

         expect(result.doc).toEqual(data);
         expect(result.metadata).toEqual(metadata);
      });
   });*/
});
