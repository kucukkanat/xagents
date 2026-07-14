import { useState } from "react";
import { PlusIcon, SearchXIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { Link } from "react-router-dom";
import { rangesForKey } from "@xagents/search";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Highlight } from "@/components/highlight";
import { PageHeader } from "@/components/page-header";
import { SearchField } from "@/components/search-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { useFuzzySearch } from "@/hooks/use-fuzzy-search";
import { deleteSkill, listSkills } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { NAME_DESC_KEYS } from "@/lib/search-keys";
import { toast } from "sonner";

export function SkillsListPage() {
  const { data, error, loading, reload } = useAsync(listSkills, []);
  const [query, setQuery] = useState("");
  const results = useFuzzySearch(data ?? [], query, NAME_DESC_KEYS);

  return (
    <>
      <PageHeader
        title="Skills"
        description="Reusable SKILL.md capabilities your agents can invoke."
        action={
          <Button asChild variant="brand">
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
          tone="brand"
          icon={SparklesIcon}
          title="Skills give your agents new abilities"
          description="Author a SKILL.md once—like a “Weekly changelog writer” or a “SQL query reviewer”—and any agent can invoke it on demand."
          action={
            <Button asChild variant="brand">
              <Link to="/skills/new">
                <PlusIcon /> New skill
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Filter skills…"
            className="max-w-sm"
          />
          {results.length === 0 ? (
            <EmptyState
              icon={SearchXIcon}
              title="No matching skills"
              description={`Nothing matches “${query.trim()}”. Try a different search.`}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((result, i) => {
                const skill = result.item;
                return (
                  // Neutral card, brand-tinted edge + slight lift on hover; capped stagger keeps
                  // the entrance snappy for long skill libraries.
                  <Card
                    key={skill.id}
                    className="flex flex-col animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out transition-all hover:-translate-y-0.5 hover:border-brand-border"
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="truncate">
                          <Link to={`/skills/${skill.id}`} className="hover:underline">
                            <Highlight text={skill.name} ranges={rangesForKey(result, "name")} />
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
                      <ConfirmDialog
                        trigger={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="press ml-auto text-muted-foreground hover:text-destructive"
                            aria-label="Delete skill"
                          >
                            <Trash2Icon />
                          </Button>
                        }
                        title={`Delete "${skill.name}"?`}
                        description="This permanently removes the skill from your agents."
                        onConfirm={async () => {
                          await deleteSkill(skill.id);
                          toast.success(`Deleted "${skill.name}"`);
                          reload();
                        }}
                      />
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
