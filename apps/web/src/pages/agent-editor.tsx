import { useEffect, useState } from "react";
import { ArrowLeftIcon, SaveIcon } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  CreateAgentInput,
  Knowledgebase,
  ReasoningEffort,
  Skill,
  Visibility,
} from "@xagents/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/hooks/use-async";
import {
  createAgent,
  getAgent,
  listKnowledgebases,
  listSkills,
  updateAgent,
} from "@/lib/api";
import { useConfig } from "@/lib/config-context";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const REASONING: readonly ReasoningEffort[] = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

interface FormState {
  name: string;
  description: string;
  instructionsMd: string;
  model: string; // `${provider}::${modelId}`
  reasoning: ReasoningEffort;
  visibility: Visibility;
  knowledgebaseIds: string[];
  skillIds: string[];
}

const EMPTY: FormState = {
  name: "",
  description: "",
  instructionsMd: "",
  model: "",
  reasoning: "provider-default",
  visibility: "private",
  knowledgebaseIds: [],
  skillIds: [],
};

export function AgentEditorPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { models } = useConfig();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [kbs, setKbs] = useState<readonly Knowledgebase[]>([]);
  const [skills, setSkills] = useState<readonly Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([listKnowledgebases().catch(() => []), listSkills().catch(() => [])])
      .then(([k, s]) => {
        if (!active) return;
        setKbs(k);
        setSkills(s);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let active = true;
    getAgent(id)
      .then(({ agent }) => {
        if (!active) return;
        setForm({
          name: agent.name,
          description: agent.description,
          instructionsMd: agent.instructionsMd,
          model: `${agent.modelProvider}::${agent.modelId}`,
          reasoning: agent.reasoning,
          visibility: agent.visibility,
          knowledgebaseIds: [...agent.knowledgebaseIds],
          skillIds: [...agent.skillIds],
        });
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [id]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const toggle = (key: "knowledgebaseIds" | "skillIds", value: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value],
    }));

  const onSave = async () => {
    const [provider, modelId] = form.model.split("::");
    if (!form.name.trim() || !form.instructionsMd.trim() || !provider || !modelId) {
      toast.error("Name, instructions, and a model are required.");
      return;
    }
    setSaving(true);
    try {
      const input: CreateAgentInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        instructionsMd: form.instructionsMd,
        modelProvider: provider as CreateAgentInput["modelProvider"],
        modelId,
        reasoning: form.reasoning,
        visibility: form.visibility,
        knowledgebaseIds: form.knowledgebaseIds,
        skillIds: form.skillIds,
      };
      const saved = isEdit && id ? await updateAgent(id, input) : await createAgent(input);
      toast.success(isEdit ? "Agent updated" : "Agent created");
      navigate(`/agents/${saved.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={isEdit ? "Edit agent" : "New agent"}
        description="Give your agent a persona, a model, and optional knowledge and skills."
        action={
          <Button variant="ghost" asChild>
            <Link to={isEdit && id ? `/agents/${id}` : "/agents"}>
              <ArrowLeftIcon /> Back
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Field label="Name" htmlFor="name">
            <Input
              id="name"
              value={form.name}
              placeholder="Research assistant"
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label="Description" htmlFor="description">
            <Input
              id="description"
              value={form.description}
              placeholder="A short summary shown on cards"
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>
          <Field label="Instructions (Markdown)" htmlFor="instructions">
            <Textarea
              id="instructions"
              value={form.instructionsMd}
              placeholder="You are a helpful assistant that…"
              className="min-h-64 font-mono text-sm"
              onChange={(e) => patch({ instructionsMd: e.target.value })}
            />
          </Field>
        </div>

        <div className="space-y-6">
          <Field label="Model" htmlFor="model">
            <Select value={form.model} onValueChange={(v) => patch({ model: v })}>
              <SelectTrigger id="model" className="w-full">
                <SelectValue placeholder={models.length ? "Select a model" : "No models available"} />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={`${m.provider}::${m.modelId}`} value={`${m.provider}::${m.modelId}`}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Reasoning effort" htmlFor="reasoning">
            <Select
              value={form.reasoning}
              onValueChange={(v) => patch({ reasoning: v as ReasoningEffort })}
            >
              <SelectTrigger id="reasoning" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONING.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Visibility" htmlFor="visibility">
            <Select
              value={form.visibility}
              onValueChange={(v) => patch({ visibility: v as Visibility })}
            >
              <SelectTrigger id="visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="public">Public (marketplace)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <AttachList
            title="Knowledgebases"
            loading={loading}
            options={kbs.map((k) => ({ id: k.id, name: k.name }))}
            selected={form.knowledgebaseIds}
            onToggle={(v) => toggle("knowledgebaseIds", v)}
          />
          <AttachList
            title="Skills"
            loading={loading}
            options={skills.map((s) => ({ id: s.id, name: s.name }))}
            selected={form.skillIds}
            onToggle={(v) => toggle("skillIds", v)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving}>
          <SaveIcon /> {saving ? "Saving…" : isEdit ? "Save changes" : "Create agent"}
        </Button>
      </div>
    </>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function AttachList({
  title,
  loading,
  options,
  selected,
  onToggle,
}: {
  title: string;
  loading: boolean;
  options: readonly { id: string; name: string }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{title}</Label>
      <Card>
        <CardContent className="max-h-48 space-y-1 overflow-y-auto p-2">
          {loading ? (
            <Skeleton className="h-8 w-full" />
          ) : options.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">None available.</p>
          ) : (
            options.map((o) => {
              const active = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onToggle(o.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border text-[10px]",
                      active ? "border-primary bg-primary text-primary-foreground" : "border-input",
                    )}
                  >
                    {active ? "✓" : ""}
                  </span>
                  <span className="truncate">{o.name}</span>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
