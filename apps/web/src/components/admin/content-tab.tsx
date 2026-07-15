import { useState } from "react";
import { AlertTriangleIcon, EyeIcon, EyeOffIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import type { AdminContentItem } from "@xagents/core";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteContent, deleteUser, getContent, getUsers, setVisibility } from "@/lib/admin-api";
import { useAdminToken } from "@/components/admin-guard";
import { AdminTable, Td, Th, fmtInt } from "@/components/admin/primitives";
import { useAsync } from "@/hooks/use-async";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type ContentKind = "agents" | "knowledgebases" | "skills" | "chats";
const KINDS = [
  { key: "agents", label: "Agents" },
  { key: "knowledgebases", label: "Knowledgebases" },
  { key: "skills", label: "Skills" },
  { key: "chats", label: "Chats" },
  { key: "users", label: "Users" },
] as const;
type KindKey = (typeof KINDS)[number]["key"];

export function ContentTab() {
  const [kind, setKind] = useState<KindKey>("agents");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border p-1 w-fit">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setKind(k.key)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              k.key === kind ? "bg-brand-subtle text-brand" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>
      {kind === "users" ? <UsersList /> : <ContentList kind={kind} />}
    </div>
  );
}

function ContentList({ kind }: { kind: ContentKind }) {
  const token = useAdminToken();
  const { data, error, loading, reload } = useAsync(() => getContent(token, kind), [token, kind]);

  const toggle = async (item: AdminContentItem): Promise<void> => {
    if (item.visibility === null) return;
    const next = item.visibility === "public" ? "private" : "public";
    try {
      await setVisibility(token, item.kind as "agent" | "knowledgebase" | "skill", item.id, next);
      toast.success(`Set ${item.name} to ${next}`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update visibility");
    }
  };

  if (loading && data === undefined) return <Skeleton className="h-64 rounded-xl" />;
  if (error !== undefined || data === undefined) {
    return (
      <EmptyState
        icon={AlertTriangleIcon}
        title="Couldn't load content"
        description={error}
        action={<Button onClick={reload}>Retry</Button>}
      />
    );
  }
  if (data.length === 0) {
    return <EmptyState icon={AlertTriangleIcon} title="Nothing here yet" />;
  }

  return (
    <AdminTable
      head={
        <tr>
          <Th>Name</Th>
          <Th>Owner</Th>
          <Th>Detail</Th>
          <Th>Visibility</Th>
          <Th>Updated</Th>
          <Th className="text-right">Actions</Th>
        </tr>
      }
    >
      {data.map((item) => (
        <tr key={item.id} className="hover:bg-muted/30">
          <Td className="font-medium">{item.name}</Td>
          <Td className="text-muted-foreground">@{item.ownerHandle}</Td>
          <Td className="text-muted-foreground">{item.detail}</Td>
          <Td>
            {item.visibility === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <Badge variant={item.visibility === "public" ? "secondary" : "outline"} className="capitalize">
                {item.visibility}
              </Badge>
            )}
          </Td>
          <Td className="whitespace-nowrap text-muted-foreground">{relativeTime(item.updatedAt)}</Td>
          <Td className="text-right">
            <div className="flex justify-end gap-1">
              {item.visibility !== null ? (
                <Button variant="ghost" size="xs" onClick={() => void toggle(item)}>
                  {item.visibility === "public" ? <EyeOffIcon /> : <EyeIcon />}
                  {item.visibility === "public" ? "Hide" : "Publish"}
                </Button>
              ) : null}
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="xs" className="text-destructive">
                    <Trash2Icon /> Delete
                  </Button>
                }
                title={`Delete "${item.name}"?`}
                description="This permanently removes it and all associated data. This cannot be undone."
                onConfirm={async () => {
                  await deleteContent(token, item.kind, item.id);
                  reload();
                }}
              />
            </div>
          </Td>
        </tr>
      ))}
    </AdminTable>
  );
}

function UsersList() {
  const token = useAdminToken();
  const { data, error, loading, reload } = useAsync(() => getUsers(token), [token]);

  if (loading && data === undefined) return <Skeleton className="h-48 rounded-xl" />;
  if (error !== undefined || data === undefined) {
    return (
      <EmptyState
        icon={UsersIcon}
        title="Couldn't load users"
        description={error}
        action={<Button onClick={reload}>Retry</Button>}
      />
    );
  }

  return (
    <AdminTable
      head={
        <tr>
          <Th>User</Th>
          <Th className="text-right">Agents</Th>
          <Th className="text-right">KBs</Th>
          <Th className="text-right">Skills</Th>
          <Th className="text-right">Chats</Th>
          <Th>Joined</Th>
          <Th className="text-right">Action</Th>
        </tr>
      }
    >
      {data.map((u) => (
        <tr key={u.id} className="hover:bg-muted/30">
          <Td>
            <span className="font-medium">{u.displayName}</span>{" "}
            <span className="text-muted-foreground">@{u.handle}</span>
          </Td>
          <Td className="text-right tabular-nums">{fmtInt(u.agents)}</Td>
          <Td className="text-right tabular-nums">{fmtInt(u.knowledgebases)}</Td>
          <Td className="text-right tabular-nums">{fmtInt(u.skills)}</Td>
          <Td className="text-right tabular-nums">{fmtInt(u.chats)}</Td>
          <Td className="whitespace-nowrap text-muted-foreground">{relativeTime(u.createdAt)}</Td>
          <Td className="text-right">
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="xs" className="text-destructive">
                  <Trash2Icon /> Delete
                </Button>
              }
              title={`Delete @${u.handle}?`}
              description="This removes the user and cascades to all their agents, knowledgebases, skills, and chats."
              onConfirm={async () => {
                await deleteUser(token, u.id);
                reload();
              }}
            />
          </Td>
        </tr>
      ))}
    </AdminTable>
  );
}
