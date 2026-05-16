import type { SyncStatus } from "../utils/useOnlineStatus";

interface Props {
  status: SyncStatus;
  isDirty: boolean;
  isSaving: boolean;
}

export default function ConnectionStatus({ status, isDirty, isSaving }: Props) {
  if (isSaving) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-500 font-medium">
        <i className="pi pi-spin pi-spinner text-[10px]"></i>
        Saving…
      </span>
    );
  }

  if (status === "offline") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
        <span className="w-2 h-2 rounded-full bg-red-500 inline-block animate-pulse"></span>
        Offline — changes saved locally
      </span>
    );
  }

  if (status === "reconnected") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
        <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
        Back online
      </span>
    );
  }

  if (isDirty) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-500 font-medium">
        <span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
        Unsaved changes
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
      <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
      Saved
    </span>
  );
}
