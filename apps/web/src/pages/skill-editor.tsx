import { useEffect, useState } from "react";
import { ArrowLeftIcon, SaveIcon } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CreateSkillInput, Visibility } from "@xagents/core";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/hooks/use-async";
import { createSkill, getSkill, updateSkill } from "@/lib/api";
import { toast } from "sonner";

/** Assemble SKILL.md: name + description become frontmatter above the body. */
const buildSkillMd = (name: string, description: string, body: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

/** Strip a leading YAML frontmatter block, leaving just the Markdown body. */
const parseBody = (skillMd: string): string => {
  const match = skillMd.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? skillMd.slice(match[0].length).replace(/^\n+/, "") : skillMd;
};

export function SkillEditorPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    getSkill(id)
      .then((skill) => {
        if (!active) return;
        setName(skill.name);
        setDescription(skill.description);
        setBody(parseBody(skill.skillMd));
        setVisibility(skill.visibility);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [id]);

  const onSave = async () => {
    if (!name.trim()) {
      toast.error("A name is required.");
      return;
    }
    setSaving(true);
    try {
      const input: CreateSkillInput = {
        name: name.trim(),
        description: description.trim(),
        skillMd: buildSkillMd(name.trim(), description.trim(), body),
        visibility,
      };
      const saved = isEdit && id ? await updateSkill(id, input) : await createSkill(input);
      toast.success(isEdit ? "Skill updated" : "Skill created");
      navigate(`/skills/${saved.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={isEdit ? "Edit skill" : "New skill"}
        description="Describe the capability in SKILL.md. Name and description become frontmatter."
        action={
          <Button variant="ghost" asChild>
            <Link to="/skills">
              <ArrowLeftIcon /> Back
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-1">
          <Label htmlFor="skill-name">Name</Label>
          <Input id="skill-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="skill-desc">Description</Label>
          <Input
            id="skill-desc"
            value={description}
            placeholder="When and why an agent should use this skill"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Body (Markdown)</Label>
        <Tabs defaultValue="edit">
          <TabsList>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="edit">
            <Textarea
              value={body}
              placeholder={"## Instructions\n\nExplain how the skill works…"}
              className="min-h-72 font-mono text-sm"
              onChange={(e) => setBody(e.target.value)}
            />
          </TabsContent>
          <TabsContent value="preview">
            <Card>
              <CardContent className="min-h-72 py-4">
                {body.trim() ? (
                  <Markdown content={body} />
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex items-center justify-between">
        <div className="w-48 space-y-2">
          <Label htmlFor="skill-vis">Visibility</Label>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
            <SelectTrigger id="skill-vis" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="public">Public (marketplace)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={onSave} disabled={saving}>
          <SaveIcon /> {saving ? "Saving…" : isEdit ? "Save changes" : "Create skill"}
        </Button>
      </div>
    </>
  );
}
