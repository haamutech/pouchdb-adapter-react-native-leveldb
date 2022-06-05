const install = require("../src/adapter");

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
   });

   it("does not use prefix", () => {
      expect(Adapter.use_prefix).toBe(false);
   });

   it("is valid", () => {
      expect(Adapter.valid()).toBe(true);
   });
});
