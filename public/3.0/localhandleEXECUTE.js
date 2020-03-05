const settings = require('./settings.json');
var database = require('./database');

const logger = require('./logger')._system;

exports.FHEM_getClientFunctions = async function FHEM_getClientFunctions() {
  var fcts = await database.gethandleEXECUTE();
  for (var f in fcts) {
    var loadFctStr = f + '=' + fcts[f];
    eval(loadFctStr);
  }

  setTimeout(FHEM_getClientFunctions, 1209600000); //update every 14 days
}
