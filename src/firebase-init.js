import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, addDoc,
  deleteDoc, getDoc, getDocs, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const dbRaw = getFirestore(app);

// Thin wrapper matching the collection().doc() chaining style the original
// artifact used, so the rest of the app's logic ports over with minimal
// changes. Not a full Firestore abstraction — just enough surface area for
// this app's needs (get/set/update/add/delete/onSnapshot).
function docRef(collectionName, id) {
  const ref = doc(dbRaw, collectionName, id);
  return {
    id,
    onSnapshot(cb, errCb) {
      return onSnapshot(ref, (snap) => cb({ exists: snap.exists(), data: () => snap.data(), id: snap.id }), errCb);
    },
    async get() {
      const snap = await getDoc(ref);
      return { exists: snap.exists(), data: () => snap.data(), id: snap.id };
    },
    set(data) { return setDoc(ref, data); },
    update(data) { return updateDoc(ref, data); },
    delete() { return deleteDoc(ref); },
  };
}

function collectionRef(collectionName) {
  const colRef = collection(dbRaw, collectionName);
  return {
    doc(id) { return docRef(collectionName, id); },
    add(data) { return addDoc(colRef, data); },
    onSnapshot(cb, errCb) {
      return onSnapshot(query(colRef), (qs) => {
        cb({ docs: qs.docs.map((d) => ({ id: d.id, data: () => d.data() })) });
      }, errCb);
    },
    async get() {
      const qs = await getDocs(query(colRef));
      return { docs: qs.docs.map((d) => ({ id: d.id, data: () => d.data() })) };
    },
  };
}

export const db = {
  collection: collectionRef,
  doc(path) {
    const [collectionName, id] = path.split("/");
    return docRef(collectionName, id);
  },
};

export const nowTimestamp = () => new Date().toISOString();
export const serverNow = serverTimestamp;
