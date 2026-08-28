// Generate a consistent color from a group name (for avatars)

export const GROUP_COLORS = [
  "from-purple-600 to-fuchsia-600",
  "from-blue-600 to-cyan-500",
  "from-emerald-600 to-teal-500",
  "from-orange-500 to-amber-500",
  "from-pink-600 to-rose-500",
  "from-indigo-600 to-violet-500",
  "from-red-600 to-orange-500",
  "from-teal-600 to-emerald-500",
];

export function groupColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}
