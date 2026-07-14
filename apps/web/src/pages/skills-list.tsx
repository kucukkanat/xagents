import { useState } from "react";
import { PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, useAsync } from "@/hooks/use-async";
import { deleteSkill, listSkills } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { toast } from "sonner";

export function SkillsListPage() {
  const { data, error, loading, reload } = useAsync(listSkills, []);
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    setBusy(id);
    try {
      await deleteSkill(id);
      toast.success(`Deleted "${name}"`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <PageHeader
        title="Skills"
        description="Reusable SKILL.md capabilities your agents can invoke."
        action={
          <Button asChild>
            <Link to="/skills/new">
              <PlusIcon /> New skill
            </Link>
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={SparklesIcon}
          title="Couldn't load skills"
          description={error}
          action={
            <Button variant="outline" onClick={reload}>
              Retry
            </Button>
          }
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={SparklesIcon}
          title="No skills yet"
          description="Author a SKILL.md to give your agents a new capability."
          action={
            <Button asChild>
              <Link to="/skills/new">
                <PlusIcon /> New skill
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((skill) => (
            <Card key={skill.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate">
                    <Link to={`/skills/${skill.id}`} className="hover:underline">
                      {skill.name}
                    </Link>
                  </CardTitle>
                  <Badge variant={skill.visibility === "public" ? "default" : "secondary"}>
                    {skill.visibility}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="line-clamp-3 text-sm text-muted-foreground">
                  {skill.description || "No description."}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  updated {relativeTime(skill.updatedAt)}
                </p>
              </CardContent>
              <CardFooter>
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/skills/${skill.id}`}>Edit</Link>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto text-muted-foreground"
                  disabled={busy === skill.id}
                  aria-label="Delete skill"
                  onClick={() => onDelete(skill.id, skill.name)}
                >
                  <Trash2Icon />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
