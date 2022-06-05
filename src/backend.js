const { FakeLevelDB, toString } = require("react-native-leveldb/lib/commonjs/fake");

function makePrefix(databaseName) {
   return `${databaseName}/`;
}

function makeStorageKey(databaseName, k) {
   return `${makePrefix(databaseName)}${toString(k)}`;
}

function useStorageKey(databaseName, k) {
   const prefix = makePrefix(databaseName);

   if (k.startsWith(prefix))
      return k.substr(prefix.length);

   return undefined;
}

/** Development Level DB implementation that stores data to local storage.
 * 
 * This implementation is very simple and not performant. You should never use this in production! 
 * Its sole purpose is to allow develop, debug and test `pouchdb-adapter-react-native-leveldb` without
 * native device/emulator. You should use a dedicated PouchDB adapter (like `pouchdb-adapter-idb`)
 * if you are planning to run react-native application in production somewhere else than in actual devices.
 */
class LevelDB extends FakeLevelDB {
   constructor(name, ...rest) {
      super(name, ...rest);

      this.name = name;

      // Read current state of local storage to memory.
      for (let i = 0; i < localStorage.length; ++i) {
         const storageKey = localStorage.key(i);
         const dbKey = useStorageKey(name, storageKey);

         // Include only keys that map correctly to this database.
         if (dbKey)
            this.put(dbKey, localStorage.getItem(storageKey));
      }
   }

   put(k, v) {
      super.put(k, v);
      localStorage.setItem(makeStorageKey(this.name, k), toString(v));
   }

   delete(k) {
      super.delete(k);
      localStorage.removeItem(makeStorageKey(this.name, k));
   }
}

function destroyLevelDatabase(databaseName) {
   for (let i = 0; i < localStorage.length; ++i) {
      const storageKey = localStorage.key(i);

      // Remove only keys that map correctly to this database.
      if (useStorageKey(databaseName, storageKey))
         localStorage.removeItem(storageKey);
   }
}

module.exports = { LevelDB, destroyLevelDatabase };
