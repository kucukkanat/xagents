import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminGuard } from "@/components/admin-guard";
import { AdminLiveProvider } from "@/components/admin/live-context";
import { ContentTab } from "@/components/admin/content-tab";
import { EventsTab } from "@/components/admin/events-tab";
import { OverviewTab } from "@/components/admin/overview-tab";
import { ProvidersTab } from "@/components/admin/providers-tab";
import { RuntimeTab } from "@/components/admin/runtime-tab";
import { RunsTab } from "@/components/admin/runs-tab";

export function AdminPage() {
  return (
    <AdminGuard>
      <AdminLiveProvider>
        <div className="space-y-6">
          <PageHeader
            title="Admin"
            description="Monitor the running platform and govern its content."
          />
          <Tabs defaultValue="overview" className="gap-6">
            <TabsList variant="line" className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="runtime">Runtime</TabsTrigger>
              <TabsTrigger value="runs">Runs</TabsTrigger>
              <TabsTrigger value="providers">Providers</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <OverviewTab />
            </TabsContent>
            <TabsContent value="runtime">
              <RuntimeTab />
            </TabsContent>
            <TabsContent value="runs">
              <RunsTab />
            </TabsContent>
            <TabsContent value="providers">
              <ProvidersTab />
            </TabsContent>
            <TabsContent value="content">
              <ContentTab />
            </TabsContent>
            <TabsContent value="events">
              <EventsTab />
            </TabsContent>
          </Tabs>
        </div>
      </AdminLiveProvider>
    </AdminGuard>
  );
}
