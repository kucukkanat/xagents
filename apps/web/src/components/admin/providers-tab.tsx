import { useCallback, useEffect, useState } from "react";
import { AlertTriangleIcon, KeyRoundIcon, PlugZapIcon, PlusIcon, StarIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type {
  AdapterDescriptor,
  AdminProvidersView,
  ProviderConfig,
  ProviderModelConfig,
} from "@xagents/core";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminToken } from "@/components/admin-guard";
import { AdminTable, Td, Th } from "@/components/admin/primitives";
import {
  createModel,
  createProvider,
  deleteModel,
  deleteProvider,
  getProviders,
  setProviderSecrets,
  testProvider,
  updateModel,
  updateProvider,
} from "@/lib/admin-api";
import { errorMessage } from "@/hooks/use-async";
import { cn } from "@/lib/utils";

const fail = (e: unknown): void => {
  toast.error(errorMessage(e));
};

export function ProvidersTab() {
  const token = useAdminToken();
  const [view, setView] = useState<AdminProvidersView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getProviders(token)
      .then((v) => {
        setView(v);
        setError(undefined);
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => load(), [load]);

  if (loading && view === undefined) return <Skeleton className="h-96 rounded-xl" />;
  if (error !== undefined || view === undefined) {
    return (
      <EmptyState
        icon={AlertTriangleIcon}
        title="Couldn't load providers"
        description={error}
        action={<Button onClick={load}>Retry</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      {!view.encryptionConfigured ? (
        <div className="flex items-start gap-3 rounded-xl border border-status-error/40 bg-status-error/10 p-4 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-status-error" />
          <div>
            <p className="font-medium">Encryption is not configured</p>
            <p className="text-muted-foreground">
              Set <code className="font-mono">SECRETS_KEY</code> to any non-empty value in the server's
              environment and restart to store and use provider API keys. Until then, keys are read-only and
              key-dependent chats fail.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Providers</h3>
          <p className="text-xs text-muted-foreground">
            Enable providers, manage their keys, and curate the models users can pick.
          </p>
        </div>
        <AddProviderDialog token={token} view={view} onChange={setView} />
      </div>

      {view.providers.length === 0 ? (
        <EmptyState icon={PlugZapIcon} title="No providers yet" description="Add one to get started." />
      ) : (
        <div className="space-y-4">
          {view.providers.map((p) => (
            <ProviderCard key={p.id} token={token} provider={p} view={view} onChange={setView} onReload={load} />
          ))}
        </div>
      )}
    </div>
  );
}

const adapterFor = (view: AdminProvidersView, kind: string): AdapterDescriptor | undefined =>
  view.adapters.find((a) => a.kind === kind);

const TEST_BADGE: Record<ProviderConfig["testStatus"], { label: string; className: string }> = {
  ok: { label: "Connection OK", className: "bg-status-running/15 text-status-running" },
  failed: { label: "Test failed", className: "bg-status-error/15 text-status-error" },
  untested: { label: "Untested", className: "bg-muted text-muted-foreground" },
};

function ProviderCard({
  token,
  provider,
  view,
  onChange,
  onReload,
}: {
  token: string;
  provider: ProviderConfig;
  view: AdminProvidersView;
  onChange: (v: AdminProvidersView) => void;
  onReload: () => void;
}) {
  const adapter = adapterFor(view, provider.adapterKind);
  const models = view.models.filter((m) => m.providerId === provider.id);
  const [settings, setSettings] = useState<Record<string, string>>(provider.settings);
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const run = async (p: Promise<AdminProvidersView>): Promise<void> => {
    setBusy(true);
    try {
      onChange(await p);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = () =>
    run(updateProvider(token, provider.id, { enabled: !provider.enabled })).then(() => {
      toast.success(provider.enabled ? `Disabled ${provider.name}` : `Enabled ${provider.name}`);
    });

  const saveSettings = () => run(updateProvider(token, provider.id, { settings }));

  const saveSecrets = () => {
    const changed = Object.fromEntries(Object.entries(secretDrafts).filter(([, v]) => v.length > 0));
    if (Object.keys(changed).length === 0) return;
    void run(setProviderSecrets(token, provider.id, changed)).then(() => {
      setSecretDrafts({});
      toast.success("Keys updated");
    });
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await testProvider(token, provider.id);
      if (res.ok) toast.success(`${provider.name}: connection OK`);
      else toast.error(res.error ?? "Connection test failed");
      onReload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const badge = TEST_BADGE[provider.testStatus];

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{provider.name}</span>
            <Badge variant="outline" className="text-xs">
              {adapter?.label ?? provider.adapterKind}
            </Badge>
            <Badge variant="ghost" className={cn("text-xs", badge.className)}>
              {badge.label}
            </Badge>
          </div>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{provider.id}</p>
        </div>
        <Button variant="outline" size="xs" disabled={busy} onClick={() => void test()}>
          <PlugZapIcon /> Test
        </Button>
        <Button
          variant={provider.enabled ? "secondary" : "default"}
          size="xs"
          disabled={busy}
          onClick={() => void toggleEnabled()}
        >
          {provider.enabled ? "Enabled" : "Disabled"}
        </Button>
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="xs" className="text-destructive">
              <Trash2Icon /> Delete
            </Button>
          }
          title={`Delete provider "${provider.name}"?`}
          description={
            provider.usage > 0
              ? `${provider.usage} agent(s) use this provider and will fail on their next turn until reconfigured. This also removes its ${models.length} model(s). This cannot be undone.`
              : "This removes the provider and its models. This cannot be undone."
          }
          onConfirm={async () => {
            onChange(await deleteProvider(token, provider.id));
          }}
        />
      </div>

      <div className="grid gap-6 p-4 md:grid-cols-2">
        {/* Settings */}
        {adapter && adapter.settingFields.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Settings</p>
            {adapter.settingFields.map((f) => (
              <div key={f.name} className="space-y-1">
                <Label htmlFor={`${provider.id}-${f.name}`}>
                  {f.label}
                  {f.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                <Input
                  id={`${provider.id}-${f.name}`}
                  value={settings[f.name] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setSettings((s) => ({ ...s, [f.name]: e.target.value }))}
                />
              </div>
            ))}
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void saveSettings()}>
              Save settings
            </Button>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">This adapter has no extra settings.</div>
        )}

        {/* Secrets */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <KeyRoundIcon className="mr-1 inline size-3" />
            Secrets
          </p>
          {adapter?.secretFields.map((f) => {
            const state = provider.secrets[f.name];
            return (
              <div key={f.name} className="space-y-1">
                <Label htmlFor={`${provider.id}-secret-${f.name}`}>{f.label}</Label>
                <Input
                  id={`${provider.id}-secret-${f.name}`}
                  type={f.multiline ? "text" : "password"}
                  autoComplete="off"
                  disabled={!view.encryptionConfigured}
                  value={secretDrafts[f.name] ?? ""}
                  placeholder={
                    state?.configured
                      ? `configured ••••${state.hint ?? ""}`
                      : `not set — ${f.placeholder ?? "enter a value"}`
                  }
                  onChange={(e) => setSecretDrafts((d) => ({ ...d, [f.name]: e.target.value }))}
                />
              </div>
            );
          })}
          <Button
            size="xs"
            variant="outline"
            disabled={busy || !view.encryptionConfigured || Object.values(secretDrafts).every((v) => v.length === 0)}
            onClick={saveSecrets}
          >
            Save keys
          </Button>
        </div>
      </div>

      {/* Models */}
      <div className="border-t p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Models ({models.length})
          </p>
          <AddModelDialog token={token} providerId={provider.id} onChange={onChange} />
        </div>
        {models.length === 0 ? (
          <p className="text-xs text-muted-foreground">No models yet — add one users can select.</p>
        ) : (
          <AdminTable
            head={
              <tr>
                <Th>Model</Th>
                <Th>Reasoning</Th>
                <Th>Price / 1M (in/out)</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            }
          >
            {models.map((m) => (
              <ModelRow key={m.id} token={token} model={m} onChange={onChange} />
            ))}
          </AdminTable>
        )}
      </div>
    </div>
  );
}

function ModelRow({
  token,
  model,
  onChange,
}: {
  token: string;
  model: ProviderModelConfig;
  onChange: (v: AdminProvidersView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (p: Promise<AdminProvidersView>): Promise<void> => {
    setBusy(true);
    try {
      onChange(await p);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const price = (v: number | null): string => (v === null ? "—" : `$${v}`);

  return (
    <tr className="hover:bg-muted/30">
      <Td>
        <div className="flex items-center gap-2">
          <span className="font-medium">{model.label}</span>
          {model.isDefault ? (
            <Badge variant="ghost" className="bg-brand-subtle text-brand text-xs">
              <StarIcon className="mr-1 size-3" /> Default
            </Badge>
          ) : null}
          {!model.enabled ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Disabled
            </Badge>
          ) : null}
        </div>
        <span className="font-mono text-xs text-muted-foreground">{model.modelId}</span>
      </Td>
      <Td className="text-muted-foreground">{model.supportsReasoning ? "Yes" : "No"}</Td>
      <Td className="tabular-nums text-muted-foreground">
        {model.pricing === null ? "—" : `${price(model.pricing.inputPer1M)} / ${price(model.pricing.outputPer1M)}`}
      </Td>
      <Td className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => void run(updateModel(token, model.id, { enabled: !model.enabled }))}
          >
            {model.enabled ? "Disable" : "Enable"}
          </Button>
          {!model.isDefault ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => void run(updateModel(token, model.id, { isDefault: true }))}
            >
              Make default
            </Button>
          ) : null}
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="xs" className="text-destructive">
                <Trash2Icon />
              </Button>
            }
            title={`Delete model "${model.label}"?`}
            description={
              model.usage > 0
                ? `${model.usage} agent(s) use this model and will fail on their next turn until reconfigured.`
                : "This removes the model from the picker."
            }
            onConfirm={async () => {
              onChange(await deleteModel(token, model.id));
            }}
          />
        </div>
      </Td>
    </tr>
  );
}

function AddProviderDialog({
  token,
  view,
  onChange,
}: {
  token: string;
  view: AdminProvidersView;
  onChange: (v: AdminProvidersView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [presetId, setPresetId] = useState(view.presets[0]?.id ?? "custom");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const preset = view.presets.find((p) => p.id === presetId) ?? view.presets[0];
  const adapter = preset ? adapterFor(view, preset.adapterKind) : undefined;
  const [settings, setSettings] = useState<Record<string, string>>(preset?.settings ?? {});

  const choosePreset = (pid: string): void => {
    setPresetId(pid);
    const p = view.presets.find((x) => x.id === pid);
    if (p) {
      setSettings(p.settings);
      if (id.length === 0 && p.id !== "custom") setId(p.id);
      if (name.length === 0 && p.id !== "custom") setName(p.label);
    }
  };

  const submit = async (): Promise<void> => {
    if (preset === undefined) return;
    setBusy(true);
    try {
      const next = await createProvider(token, {
        id: id.trim(),
        name: name.trim(),
        adapterKind: preset.adapterKind,
        settings,
      });
      onChange(next);
      toast.success(`Added ${name}`);
      setOpen(false);
      setId("");
      setName("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> Add provider
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a provider</DialogTitle>
          <DialogDescription>Pick a preset (pre-fills endpoints) or a custom OpenAI-compatible one.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Preset</Label>
            <Select value={presetId} onValueChange={choosePreset}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {view.presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {adapter ? <p className="text-xs text-muted-foreground">{adapter.hint}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="np-id">Id (slug)</Label>
              <Input id="np-id" value={id} placeholder="my-provider" onChange={(e) => setId(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="np-name">Name</Label>
              <Input id="np-name" value={name} placeholder="My Provider" onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          {adapter?.settingFields.map((f) => (
            <div key={f.name} className="space-y-1">
              <Label htmlFor={`np-${f.name}`}>
                {f.label}
                {f.required ? <span className="text-destructive"> *</span> : null}
              </Label>
              <Input
                id={`np-${f.name}`}
                value={settings[f.name] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setSettings((s) => ({ ...s, [f.name]: e.target.value }))}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            You'll add the API key and models after the provider is created.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || id.trim().length === 0 || name.trim().length === 0} onClick={() => void submit()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddModelDialog({
  token,
  providerId,
  onChange,
}: {
  token: string;
  providerId: string;
  onChange: (v: AdminProvidersView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [label, setLabel] = useState("");
  const [supportsReasoning, setSupportsReasoning] = useState(false);
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const num = (s: string): number | null => (s.trim().length === 0 ? null : Number(s));

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await createModel(token, providerId, {
        modelId: modelId.trim(),
        label: label.trim(),
        supportsReasoning,
        inputPer1M: num(inputPrice),
        outputPer1M: num(outputPrice),
      });
      onChange(next);
      toast.success(`Added ${label}`);
      setOpen(false);
      setModelId("");
      setLabel("");
      setInputPrice("");
      setOutputPrice("");
      setSupportsReasoning(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline">
          <PlusIcon /> Add model
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a model</DialogTitle>
          <DialogDescription>The model id must match what the provider's SDK expects.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="nm-id">Model id</Label>
              <Input id="nm-id" value={modelId} placeholder="gpt-4o" onChange={(e) => setModelId(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nm-label">Label</Label>
              <Input id="nm-label" value={label} placeholder="GPT-4o" onChange={(e) => setLabel(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="nm-in">Input $ / 1M</Label>
              <Input id="nm-in" inputMode="decimal" value={inputPrice} placeholder="optional" onChange={(e) => setInputPrice(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nm-out">Output $ / 1M</Label>
              <Input id="nm-out" inputMode="decimal" value={outputPrice} placeholder="optional" onChange={(e) => setOutputPrice(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={supportsReasoning}
              onChange={(e) => setSupportsReasoning(e.target.checked)}
            />
            Supports a reasoning / thinking effort control
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || modelId.trim().length === 0 || label.trim().length === 0} onClick={() => void submit()}>
            Add model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
