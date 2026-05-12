import { toTitleCase } from "../utils/formatters";

interface InstructorHeaderProps {
  logo: string;
  greeting: string;
  nickname: string;
  photoURL: string | null;
  onMenuOpen: () => void;
}

export default function InstructorHeader({
  logo,
  greeting,
  nickname,
  photoURL,
  onMenuOpen,
}: InstructorHeaderProps) {
  const displayName = toTitleCase(nickname || "Instructor");
  const initial = (nickname || "I").charAt(0).toUpperCase();

  return (
    <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 shadow-sm border-b border-gray-200 dark:border-gray-700">

      {/* Mobile: hamburger */}
      <button
        onClick={onMenuOpen}
        className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
        aria-label="Open menu"
      >
        <i className="pi pi-bars text-lg"></i>
      </button>

      {/* Mobile: USTP logo + name */}
      <div className="flex lg:hidden items-center gap-2">
        <img
          src={logo}
          alt="USTP"
          draggable={false}
          className="h-7 w-auto object-contain select-none"
        />
        <span className="font-semibold text-sm text-gray-700 dark:text-gray-200">
          USTP Villanueva
        </span>
      </div>

      {/* Desktop spacer */}
      <div className="hidden lg:block" />

      {/* Right — greeting + avatar */}
      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight">
            {greeting},{" "}
            <span className="text-blue-600 dark:text-blue-400">{displayName}</span>
          </p>
        </div>

        {photoURL ? (
          <img
            src={photoURL}
            alt="Profile"
            draggable={false}
            className="w-9 h-9 rounded-full object-cover border-2 border-blue-200 dark:border-blue-700 select-none pointer-events-none shrink-0"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 border-2 border-blue-200 dark:border-blue-700 flex items-center justify-center shrink-0 select-none">
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
              {initial}
            </span>
          </div>
        )}
      </div>

    </div>
  );
}
