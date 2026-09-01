// Generate a consistent color from a group name (for avatars)

// Muted duotone gradients for chat avatars — quiet, so the gossip-pink
// message bubbles remain the only bold color on screen.
export const GROUP_COLORS = [
  "from-rose-500 to-pink-500",
  "from-sky-600 to-indigo-500",
  "from-teal-500 to-emerald-500",
  "from-amber-500 to-orange-500",
  "from-violet-600 to-purple-500",
  "from-cyan-600 to-sky-500",
  "from-fuchsia-600 to-rose-500",
  "from-lime-600 to-teal-500",
];

export function groupColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}
