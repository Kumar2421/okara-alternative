import { Info } from "lucide-react";
import IntegrationCard from "@/components/settings/IntegrationCard";
import ApiIntegrationCard from "@/components/settings/ApiIntegrationCard";
import { cmsIntegrations, socialIntegrations, codeRepoIntegrations } from "@/lib/mock-integrations";

export default function IntegrationsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Article Publishing</h1>
      <p className="mb-4 text-[13px] text-gray-500">Publish articles directly to your CMS or blog platform</p>

      <div className="mb-5 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">
        <Info size={14} className="shrink-0 text-gray-400" />
        You can connect one publishing destination at a time.
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3">
        {cmsIntegrations.map((i) => (
          <IntegrationCard key={i.id} name={i.name} desc={i.desc} icon={i.icon} color={i.color} />
        ))}
      </div>

      <h2 className="text-[15px] font-semibold text-gray-900">Socials</h2>
      <p className="mb-4 text-[13px] text-gray-500">Connect your social accounts to post and share content</p>
      <div className="mb-8 grid grid-cols-2 gap-3">
        {socialIntegrations.map((i) => {
          if (i.name === "Reddit" || i.name === "X (Twitter)") {
            return (
              <ApiIntegrationCard 
                key={i.id} 
                name={i.name} 
                desc={i.desc} 
                icon={i.icon} 
                color={i.color} 
                settingKey={i.name === "Reddit" ? "reddit_api_key" : "x_api_key"}
              />
            );
          }
          return <IntegrationCard key={i.id} name={i.name} desc={i.desc} icon={i.icon} color={i.color} />;
        })}
      </div>

      <h2 className="text-[15px] font-semibold text-gray-900">Code Repository</h2>
      <p className="mb-4 text-[13px] text-gray-500">Connect a GitHub repo so the SEO agent can open pull requests against it</p>
      <div className="grid grid-cols-2 gap-3">
        {codeRepoIntegrations.map((i) => (
          <IntegrationCard key={i.id} name={i.name} desc={i.desc} icon={i.icon} color={i.color} />
        ))}
      </div>
    </div>
  );
}
