const crypto=require('crypto');
exports.id=(n=9)=>crypto.randomBytes(n).toString('hex');
exports.hash=(s,salt)=>crypto.scryptSync(String(s),salt,32).toString('hex');
exports.eq=(a,b)=>{a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&crypto.timingSafeEqual(a,b)};
