const { LevelDB, destroyLevelDatabase } = require("../../src/backend.native");

jest.mock("react-native-leveldb",  () => {
   const MockLevelDB = {
      destroyDB: jest.fn(),
   };

   return { LevelDB: MockLevelDB };
});

it("exports LevelDB", () => {
   expect(LevelDB).toBeDefined();
});

it("exports destroyLevelDatabase", () => {
   expect(destroyLevelDatabase).toBeDefined();
});

it("destroys LevelDB database", () => {
   const databaseName = "db name";

   destroyLevelDatabase(databaseName);

   expect(LevelDB.destroyDB).toHaveBeenCalledWith(databaseName);
});
