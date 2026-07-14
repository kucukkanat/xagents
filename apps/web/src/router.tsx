import { createBrowserRouter, Link } from "react-router-dom";
import { AppShell, PaddedLayout } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { AgentDetailPage } from "@/pages/agent-detail";
import { AgentEditorPage } from "@/pages/agent-editor";
import { AgentsListPage } from "@/pages/agents-list";
import { ChatPage } from "@/pages/chat";
import { KnowledgebaseDetailPage } from "@/pages/knowledgebase-detail";
import { KnowledgebasesListPage } from "@/pages/knowledgebases-list";
import { MarketplacePage } from "@/pages/marketplace";
import { SkillEditorPage } from "@/pages/skill-editor";
import { SkillsListPage } from "@/pages/skills-list";

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-3xl font-semibold">404</p>
      <p className="text-muted-foreground">This page doesn&apos;t exist.</p>
      <Button asChild>
        <Link to="/">Back to marketplace</Link>
      </Button>
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
          { index: true, element: <MarketplacePage /> },
          { path: "agents", element: <AgentsListPage /> },
          { path: "agents/new", element: <AgentEditorPage /> },
          { path: "agents/:id", element: <AgentDetailPage /> },
          { path: "agents/:id/edit", element: <AgentEditorPage /> },
          { path: "knowledgebases", element: <KnowledgebasesListPage /> },
          { path: "knowledgebases/:id", element: <KnowledgebaseDetailPage /> },
          { path: "skills", element: <SkillsListPage /> },
          { path: "skills/new", element: <SkillEditorPage /> },
          { path: "skills/:id", element: <SkillEditorPage /> },
          { path: "*", element: <NotFound /> },
        ],
      },
      { path: "chat/:chatId", element: <ChatPage /> },
    ],
  },
]);
