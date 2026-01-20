const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const crypto = require("crypto");
admin.initializeApp();
const db = admin.firestore();

function hashDevice(data){ return crypto.createHash("sha256").update(data).digest("hex"); }

async function getGeoFromIP(ip){
  try{
    const res = await fetch(`https://ipapi.co/${ip}/json/`);
    const data = await res.json();
    return { country:data.country, city:data.city };
  }catch(e){ return { country:"Unknown", city:"Unknown" }; }
}

exports.createUserProfile = functions.auth.user().onCreate(async (user) => {
  const code = Math.random().toString(36).substring(2,8).toUpperCase();
  await db.collection("users").doc(user.uid).set({
    email:user.email,
    balance:0,
    referralCode:code,
    createdAt: admin.firestore.Timestamp.now()
  });
});

exports.rewardUser = functions.https.onCall(async (_, context)=>{
  if(!context.auth) throw new functions.https.HttpsError("unauthenticated");
  const uid = context.auth.uid;
  const ip = context.rawRequest.ip;
  const deviceHash = hashDevice(context.rawRequest.headers['user-agent']);

  // Fraud check
  const fraudSnap = await db.collection("fraud").where("deviceHash","==",deviceHash).get();
  if(fraudSnap.size > 2) throw new functions.https.HttpsError("permission-denied","Multiple accounts detected");
  await db.collection("fraud").add({uid, ip, deviceHash, time:admin.firestore.Timestamp.now()});

  // Geo check
  const geo = await getGeoFromIP(ip);
  const allowedCountries = process.env.ALLOWED_COUNTRIES.split(",");
  if(!allowedCountries.includes(geo.country)) throw new functions.https.HttpsError("permission-denied",`Ads not available in ${geo.country}`);

  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  const lastAd = userDoc.data().lastAdTime?.toMillis() || 0;
  if(Date.now()-lastAd<30000) throw new functions.https.HttpsError("failed-precondition","Cooldown active");

  const analyticsRef = db.collection("analytics").doc("global");
  await db.runTransaction(async t=>{
    t.update(userRef,{
      balance: admin.firestore.FieldValue.increment(5),
      lastAdTime: admin.firestore.Timestamp.now()
    });

    // Referral reward
    if(userDoc.data().referredBy && !userDoc.data().referralPaid){
      const refSnap = await db.collection("users").where("referralCode","==",userDoc.data().referredBy).get();
      if(!refSnap.empty){
        const refUser = refSnap.docs[0].ref;
        t.update(refUser,{
          balance: admin.firestore.FieldValue.increment(10),
          referralEarnings: admin.firestore.FieldValue.increment(10)
        });
        t.update(userRef,{referralPaid:true});
      }
    }

    // Analytics
    t.set(analyticsRef,{
      totalAdViews: admin.firestore.FieldValue.increment(1),
      totalRevenue: admin.firestore.FieldValue.increment(0.02)
    },{merge:true});
  });
  return {reward:5};
});

exports.dailyBonus = functions.https.onCall(async(_,context)=>{
  const uid = context.auth.uid;
  const userRef = db.collection("users").doc(uid);
  const doc = await userRef.get();
  const last = doc.data().lastDailyBonus?.toMillis()||0;
  if(Date.now()-last<86400000) throw new functions.https.HttpsError("failed-precondition","Already claimed");
  await userRef.update({balance:admin.firestore.FieldValue.increment(20), lastDailyBonus:admin.firestore.Timestamp.now()});
  return {reward:20};
});

exports.autoPayout = functions.firestore.document('withdrawals/{id}')
.onUpdate(async (snap, context)=>{
  const before = snap.before.data();
  const after = snap.after.data();
  if(before.status==="pending" && after.status==="paid"){
    console.log("Trigger payout to user", after.uid);
  }
});
