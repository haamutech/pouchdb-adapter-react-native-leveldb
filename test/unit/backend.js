const { LevelDB, destroyLevelDatabase } = require("../../src/backend");
const { toString } = require("react-native-leveldb/lib/commonjs/fake");

it("exports LevelDB", () => {
   expect(LevelDB).toBeDefined();
});

it("exports destroyLevelDatabase", () => {
   expect(destroyLevelDatabase).toBeDefined();
});

it("clears local storage when database gets destroyed", () => {
   const databaseName = "dbname";
   const data = [
      `${databaseName}/key`,
      "random/key",
      `${databaseName}/other`,
   ];

   global.localStorage = {
      length: data.length,
      key: jest.fn(i => data[i]),
      removeItem: jest.fn(),
   };

   destroyLevelDatabase(databaseName);

   expect(global.localStorage.key).toHaveBeenCalledTimes(data.length);
   expect(global.localStorage.removeItem.mock.calls).toEqual([
      [data[0]],
      [data[2]],
   ]);
});

describe("LevelDB", () => {
   it("puts string to local storage", () => {
      global.localStorage = {
         length: 0,
         setItem: jest.fn(),
      };

      const databaseName = "dbname";
      const key = "some key";
      const value = "some value";

      const db = new LevelDB(databaseName);

      db.put(key, value);

      expect(global.localStorage.setItem).toHaveBeenCalledWith(`${databaseName}/some key`, value);
   });

   it("puts buffer to local storage", () => {
      global.localStorage = {
         length: 0,
         setItem: jest.fn(),
      };

      const databaseName = "dbname";
      const key = "some key";
      const value = new Uint32Array([1, 2, 3]);

      const db = new LevelDB(databaseName);

      db.put(key, value.buffer);

      expect(global.localStorage.setItem).toHaveBeenCalledWith(`${databaseName}/some key`, toString(value.buffer));
   });

   it("deletes key from local storage", () => {
      global.localStorage = {
         length: 0,
         removeItem: jest.fn(),
      };

      const databaseName = "dbname";
      const key = "some key";

      const db = new LevelDB(databaseName);

      db.delete(key);

      expect(global.localStorage.removeItem).toHaveBeenCalledWith(`${databaseName}/some key`);
   });

   it("constructs state from local storage", () => {
      const databaseName = "dbname";
      const data = [
         `${databaseName}/key`,
         "random/key",
         `${databaseName}/other`,
      ];

      global.localStorage = {
         length: data.length,
         key: jest.fn(i => data[i]),

         // TODO: test also buffer items
         getItem: jest.fn(k => `value for ${k}`),
      };

      jest.spyOn(LevelDB.prototype, "put").mockImplementation(() => {});

      const db = new LevelDB(databaseName);

      expect(global.localStorage.key).toHaveBeenCalledTimes(data.length);

      expect(global.localStorage.getItem.mock.calls).toEqual([
         [data[0]],
         [data[2]],
      ]);

      expect(db.put.mock.calls).toEqual([
         ["key", `value for ${data[0]}`],
         ["other", `value for ${data[2]}`],
      ]);
   });
});
