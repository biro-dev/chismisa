// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/actions/auth", () => ({ logoutAction: vi.fn() }));

import { GroupSidebar } from "@/components/group-sidebar";
import type { Group } from "@/lib/types";

const groups: Group[] = [
  {
    id: "group_1",
    name: "Chismis Central",
    code: "CODE-1",
    isOwner: true,
    memberCount: 5,
    messageCount: 42,
    unreadCount: 0,
  },
  {
    id: "group_2",
    name: "Tea Time",
    code: "CODE-2",
    isOwner: false,
    memberCount: 2,
    messageCount: 7,
    unreadCount: 3,
  },
];

function makeSidebar(overrides: Partial<Parameters<typeof GroupSidebar>[0]> = {}) {
  const props = {
    username: "chismosa",
    theme: "dark" as const,
    onToggleTheme: vi.fn(),
    groups,
    selectedGroupId: "group_1",
    onSelectGroup: vi.fn(),
    sidebarOpen: false,
    onCloseSidebar: vi.fn(),
    onShowCreate: vi.fn(),
    onShowJoin: vi.fn(),
    ...overrides,
  };
  render(<GroupSidebar {...props} />);
  return props;
}

describe("GroupSidebar", () => {
  it("renders the username and their groups", () => {
    makeSidebar();
    expect(screen.getByText("chismosa")).toBeTruthy();
    expect(screen.getByText("Chismis Central")).toBeTruthy();
    expect(screen.getByText("Tea Time")).toBeTruthy();
    expect(screen.getByText("5 members · 42 msgs")).toBeTruthy();
  });

  it("highlights the selected group and marks the owner", () => {
    makeSidebar();
    const selected = screen.getByText("Chismis Central").closest("button");
    expect(selected!.className).toContain("bg-purple-600/20");
    expect(screen.getByText("OWNER")).toBeTruthy();
  });

  it("shows an empty state when there are no groups", () => {
    makeSidebar({ groups: [] });
    expect(screen.getByText(/No groups yet/)).toBeTruthy();
  });

  it("selects a group and closes the sidebar on click", async () => {
    const { onSelectGroup, onCloseSidebar } = makeSidebar();
    await userEvent.click(screen.getByText("Tea Time"));
    expect(onSelectGroup).toHaveBeenCalledWith("group_2");
    expect(onCloseSidebar).toHaveBeenCalled();
  });

  it("opens the create modal and closes the sidebar", async () => {
    const { onShowCreate, onCloseSidebar } = makeSidebar();
    await userEvent.click(screen.getByText("Create"));
    expect(onShowCreate).toHaveBeenCalledTimes(1);
    expect(onCloseSidebar).toHaveBeenCalled();
  });

  it("opens the join modal", async () => {
    const { onShowJoin } = makeSidebar();
    await userEvent.click(screen.getByText("Join"));
    expect(onShowJoin).toHaveBeenCalledTimes(1);
  });

  it("toggles the theme", async () => {
    const { onToggleTheme } = makeSidebar();
    await userEvent.click(screen.getByTitle("Switch to light mode"));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("does not highlight any group when none is selected", () => {
    makeSidebar({ selectedGroupId: null });
    const button = screen.getByText("Chismis Central").closest("button");
    expect(button!.className).not.toContain("bg-purple-600/20");
  });

  it("shows an unread badge on groups with unread messages", () => {
    makeSidebar({ selectedGroupId: "group_1" });
    const badge = screen.getByText("3");
    expect(badge.className).toContain("rounded-full");
    const teaTime = screen.getByText("Tea Time").closest("button");
    expect(teaTime!.textContent).toContain("3");
  });

  it("hides the unread badge for the selected group and for read groups", () => {
    makeSidebar({ selectedGroupId: "group_2" });
    // group_2 is selected — badge hidden even though unreadCount is 3
    expect(screen.queryByText("3")).toBeNull();
  });

  it('caps the unread badge at "99+"', () => {
    makeSidebar({
      selectedGroupId: "group_1",
      groups: [
        { ...groups[0], unreadCount: 0 },
        { ...groups[1], unreadCount: 250 },
      ],
    });
    expect(screen.getByText("99+")).toBeTruthy();
  });
});
