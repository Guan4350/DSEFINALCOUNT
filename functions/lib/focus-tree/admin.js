"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = exports.db = void 0;
exports.assertAdmin = assertAdmin;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const https_1 = require("firebase-functions/v2/https");
if ((0, app_1.getApps)().length === 0) {
    (0, app_1.initializeApp)();
}
exports.db = (0, firestore_1.getFirestore)();
exports.auth = (0, auth_1.getAuth)();
/** 管理員判定沿用現有 admins/{uid}.active 模型。 */
async function assertAdmin(uid) {
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'E_NOT_ADMIN');
    }
    const snap = await exports.db.doc(`admins/${uid}`).get();
    if (!snap.exists || snap.get('active') !== true) {
        throw new https_1.HttpsError('permission-denied', 'E_NOT_ADMIN');
    }
    return uid;
}
//# sourceMappingURL=admin.js.map