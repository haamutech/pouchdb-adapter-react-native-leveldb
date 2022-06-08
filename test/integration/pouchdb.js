const PouchDB = require("pouchdb-core");
const Adapter = require("../../src/adapter");

const Database = PouchDB
   .plugin(Adapter)
   .defaults({
      adapter: "react-native-leveldb",
   });

beforeEach(() => {
   global.localStorage = {
      key: jest.fn(),
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
   };
});

it("create a database instance", async () => {
   const db = new Database("test");

   expect(await db.info()).toEqual({
      adapter: "react-native-leveldb",
      doc_count: 0,
      update_seq: 0,
      db_name: "test",
      auto_compaction: false,
   });
});

it("inserts a new document and retrieves it", async () => {
   const db = new Database("test");
   const doc = {
      _id: "doc-id-1",
      key: "value",
   };

   await db.put(doc);

   const result = await db.get(doc._id);

   expect(result).toEqual({
      _id: doc._id,
      _rev: expect.anything(),
      key: "value",
   });
});
