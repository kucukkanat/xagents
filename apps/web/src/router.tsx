import { createBrowserRouter, Link, Navigate } from "react-router-dom";
import { CompassIcon } from "lucide-react";
import { AppShell, PaddedLayout } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { AdminPage } from "@/pages/admin";
import { AgentDetailPage } from "@/pages/agent-detail";
import { AgentEditorPage } from "@/pages/agent-editor";
import { AgentsListPage } from "@/pages/agents-list";
import { ChatPage } from "@/pages/chat";
import { ConversationsPage } from "@/pages/conversations";
import { KnowledgebaseDetailPage } from "@/pages/knowledgebase-detail";
import { KnowledgebasesListPage } from "@/pages/knowledgebases-list";
import { MarketplacePage } from "@/pages/marketplace";
import { SkillEditorPage } from "@/pages/skill-editor";
import { SkillsListPage } from "@/pages/skills-list";

function NotFound() {
  return (
    <div className="py-16">
      <EmptyState
        icon={CompassIcon}
        tone="brand"
        title="This page drifted off the map"
        description="The link may be broken or the page may have moved. Let's get you back."
        action={
          <Button asChild>
            <Link to="/">Back to chats</Link>
          </Button>
        }
      />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      {
        element: <PaddedLayout />,
        children: [
          { index: true, element: <ConversationsPage /> },
          { path: "explore", element: <MarketplacePage /> },
          { path: "marketplace", element: <Navigate to="/explore" replace /> },
          { path: "agents", element: <AgentsListPage /> },
          { path: "agents/new", element: <AgentEditorPage /> },
          { path: "agents/:id", element: <AgentDetailPage /> },
          { path: "agents/:id/edit", element: <AgentEditorPage /> },
          { path: "knowledgebases", element: <KnowledgebasesListPage /> },
          { path: "knowledgebases/:id", element: <KnowledgebaseDetailPage /> },
          { path: "skills", element: <SkillsListPage /> },
          { path: "skills/new", element: <SkillEditorPage /> },
          { path: "skills/:id", element: <SkillEditorPage /> },
          { path: "admin", element: <AdminPage /> },
          { path: "*", element: <NotFound /> },
        ],
      },
      { path: "chat/:chatId", element: <ChatPage /> },
    ],
  },
]);
