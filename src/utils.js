function pad16(value) {
   return ("0000000000000000" + value).slice(-16);
}

module.exports = { pad16 };
