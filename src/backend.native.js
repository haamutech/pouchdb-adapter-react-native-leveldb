const { LevelDB } = require("react-native-leveldb");

function destroyLevelDatabase(name) {
   LevelDB.destroyDB(name);
}

module.exports = { LevelDB, destroyLevelDatabase };
