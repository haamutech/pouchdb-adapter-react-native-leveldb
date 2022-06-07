pouchdb-adapter-react-native-leveldb
======

PouchDB adapter for React Native that uses LevelDB as its backing store. Designed to run in React Native. Its adapter name is `'react-native-leveldb'`.


### Work in progress!

This adapter is still pretty much work in progress (early PoC is done already). Here is a TODO list that needs to be completed before this can be used:

- [ ] Support attachments
- [ ] Support compaction
- [ ] Implement all `TODO` comments
- [x] Prove that `LevelDB` works in `backend.js`
- [x] Prove that `LevelDB` is available in `backend.native.js`
- [x] Prove that `destroyLevelDatabase` works in `backend.js`
- [x] Prove that `destroyLevelDatabase` works in `backend.native.js`
- [x] Prove that `_info` works
- [x] Prove that `_get` works
- [ ] Prove that `_allDocs` works
- [x] Prove that `_getRevisionTree` works
- [x] Prove that `_bulkDocs` works
- [x] Prove that `_close` works
- [x] Prove that `_destroy` works


### Usage

Install peer dependency packages [pouchdb-core](https://www.npmjs.com/package/pouchdb-core), [react-native-leveldb](https://www.npmjs.com/package/react-native-leveldb) and [react-native-get-random-values](https://www.npmjs.com/package/react-native-get-random-values):

```bash
npm install pouchdb-core react-native-leveldb react-native-get-random-values --save
```

Register the plugin and create a database instance:

```js
PouchDB.plugin(require("pouchdb-adapter-react-native-leveldb"));
const db = new PouchDB("my_db", { adapter: "react-native-leveldb" });
```

For full API documentation and guides on PouchDB, see [PouchDB.com](http://pouchdb.com/). For details on PouchDB sub-packages, see the [Custom Builds documentation](http://pouchdb.com/custom.html).
