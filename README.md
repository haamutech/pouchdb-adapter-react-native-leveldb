pouchdb-adapter-react-native-leveldb
======

PouchDB adapter for React Native that uses LevelDB as its backing store. Designed to run in React Native. Its adapter name is `react-native-leveldb`.

This adapter relies on awesome work with [react-native-leveldb](https://github.com/greentriangle/react-native-leveldb) that is a high performance standalone database for React Native. Now PouchDB actually fits in your pocket! 

- Faster and more versatile than AsyncStorage and SQLite
   - AsyncStorage has size limits especially in Android
   - SQLite is not a NoSQL store designed to store schemaless documents
- Almost complete implementation of PouchDB adapter API
   - No support for attachments yet
   - No support for `_putLocal`, `_getLocal` and `_removeLocal`
   - Some shortages on how document revisions are handled (please see TODO comments in code)
- PouchDB is a perfect fit for mobile applications: you can write data locally and let database sync it automatically to cloud when the connection is available
- Supports [react-native-web](https://github.com/necolas/react-native-web) for development purposes so that you can test your application in a web browser
   - Stores data to local storage
- Fully tested, code coverage ~100%

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
