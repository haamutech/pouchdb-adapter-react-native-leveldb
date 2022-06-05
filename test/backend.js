const { LevelDB, destroyLevelDatabase } = require("../src/backend");

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
