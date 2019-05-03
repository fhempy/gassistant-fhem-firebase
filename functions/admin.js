const bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var flash = require('connect-flash');
const functions = require("firebase-functions");
const express = require('express');
const cors = require('cors');
const jsonwt = require('jsonwebtoken');
const utils = require('./utils');
const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;
const settings = require('./settings.json');
var authRouter = require('./adminauth');

//session handling
var session = require('express-session');
const FirebaseStore = require('connect-session-firebase')(session);
const firebase = require('firebase-admin');
var passport = require('passport');
var Auth0Strategy = require('passport-auth0');

var sess = {
  store: new FirebaseStore({
         database: firebase.database()
    }),
  name: '__session',
  secret: settings.COOKIE_SECRET,
  cookie: {
    secure: false
  },
  resave: false,
  saveUninitialized: true
};

// Configure Passport to use Auth0
var strategy = new Auth0Strategy(
  {
    domain: settings.AUTH0_LOGIN_DOMAIN,
    clientID: settings.AUTH0_WEB_CLIENTID,
    clientSecret: settings.AUTH0_WEB_CLIENTSECRET,
    callbackURL: settings.AUTH0_CALLBACK_URL
  },
  function (accessToken, refreshToken, extraParams, profile, done) {
    // accessToken is the token to call Auth0 API (not needed in the most cases)
    // extraParams.id_token has the JSON Web Token
    // profile has all the information from the user
    return done(null, profile);
  }
);

passport.use(strategy);

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});

const app = express();
//app.use(utils.jwtCheck);
//app.use(cors());
app.use(cookieParser());
//app.use(bodyParser.json());
//app.use(bodyParser.urlencoded({extended: true}));

app.use(session(sess));
app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
  var uid = 'unknown';
  if (req.user) {
    uid = req.user.id;
  }
  uidlog(uid, 'Function called: ' + req.originalUrl);
  next();
});

app.use(flash());
// Handle auth failure error messages
app.use(function (req, res, next) {
  if (req && req.query && req.query.error) {
    req.flash('error', req.query.error);
  }
  if (req && req.query && req.query.error_description) {
    req.flash('error_description', req.query.error_description);
  }
  next();
});

app.use('/', authRouter);

var secured = function () {
  return function secured (req, res, next) {
    if (req.user) { return next(); }
    req.session.returnTo = req.originalUrl;
    res.redirect('/admin/login');
  };
};

app.get('/listversions', secured(), async (req, res) => {
  const {id: uid} = req.user;
  if (uid === settings.ADMIN_UID) {
    var result = '';
    var colRefs = await utils.getFirestoreDB().getCollections();
    for (let col of colRefs) {
      result = result + col.id + ":";
      const doc = await col.doc('client').get();
      if (doc.exists && doc.data().packageversion) {
        result = result + doc.data().packageversion;
      }
      const hbRef = await utils.getRealDB().ref('/users/' + col.id + '/heartbeat').once('value');
      if (hbRef.val() && hbRef.val().time) {
        if (hbRef.val().time > (Date.now() - 600000)) {
          result = result + ":ACTIVE";
        } else {
          result = result + ":-";
        }
      }
      result = result + "<br>";
    }
    res.send(result);
  } else {
    res.sendStatus(401);
  }
});

// Production error handler
// No stacktraces leaked to user
// app.use(function (err, req, res, next) {
//   res.status(err.status || 500);
//   res.render('error', {
//     message: err.message,
//     error: {}
//   });
// });

// Catch 404 and forward to error handler
app.use(function (req, res, next) {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

const admin = functions.region('us-central1').https.onRequest(app);

module.exports = {
  admin
};
