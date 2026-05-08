import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

export type LogResult = "Success" | "Failed" | "Warning";

export const logActivity = async (
  uid: string,
  opts: {
    module: string;
    action: string;
    affectedItem?: string;
    result?: LogResult;
    ipAddress?: string;
    remarks?: string;
  }
): Promise<void> => {
  try {
    await addDoc(collection(db, "instructors", uid, "logs"), {
      module:       opts.module,
      action:       opts.action,
      affectedItem: opts.affectedItem ?? "",
      result:       opts.result       ?? "Success",
      ipAddress:    opts.ipAddress    ?? "",
      remarks:      opts.remarks      ?? "",
      timestamp:    serverTimestamp(),
    });
  } catch (err) {
    console.warn("[activityLog] Failed to write log:", err);
  }
};
