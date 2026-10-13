import {
  adminEnabled, clearLoginFailures, loginLockedOut, makeSessionValue, passwordMatches, recordLoginFailure, sessionValueValid,
} from "../../src/lib/adminAuth.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

delete process.env.ADMIN_PASSWORD;
ok(!adminEnabled(), "disabled without ADMIN_PASSWORD");
ok(!passwordMatches("") && !passwordMatches("anything"), "no password matches when disabled");
ok(!sessionValueValid(makeSessionValue()), "no session is valid when disabled");

process.env.ADMIN_PASSWORD = "hunter2";
ok(adminEnabled(), "enabled with ADMIN_PASSWORD");
ok(passwordMatches("hunter2") && !passwordMatches("hunter3") && !passwordMatches("") && !passwordMatches("hunter2 "), "password comparison is exact");

const now = Date.now();
const v = makeSessionValue(now);
ok(sessionValueValid(v, now + 1000), "a fresh session is valid");
ok(!sessionValueValid(v, now + 8 * 24 * 3600 * 1000), "a session expires after a week");
ok(!sessionValueValid(undefined) && !sessionValueValid("") && !sessionValueValid("abc") && !sessionValueValid("1.2.3"), "junk values are invalid");
const [exp, mac] = v.split(".");
ok(!sessionValueValid(`${Number(exp) + 100000}.${mac}`, now), "changing the expiry invalidates the signature");
ok(!sessionValueValid(`${exp}.${mac.slice(0, -2)}xx`, now), "a tampered signature is rejected");
process.env.ADMIN_PASSWORD = "different";
ok(!sessionValueValid(v, now + 1000), "changing the password signs everyone out");
process.env.ADMIN_PASSWORD = "hunter2";

clearLoginFailures();
ok(!loginLockedOut(), "not locked out at first");
for (let i = 0; i < 7; i++) recordLoginFailure(now);
ok(!loginLockedOut(now), "7 failures are tolerated");
recordLoginFailure(now);
ok(loginLockedOut(now), "the 8th failure locks logins out");
ok(!loginLockedOut(now + 6 * 60 * 1000), "the lockout ends after five minutes");
recordLoginFailure(now); clearLoginFailures();
ok(!loginLockedOut(now), "a successful login clears the count");
