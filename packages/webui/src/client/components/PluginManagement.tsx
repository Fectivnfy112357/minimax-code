import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  InstalledPluginSource,
  MarketplaceCategory,
} from "@mavis/protocol/local";
import type { WebuiPluginManagementAction } from "../../shared/plugin-management.js";
import type { WebuiTransport } from "../contracts.js";

type Row = Record<string, unknown>;
type Area = "plugins" | "skills" | "apps" | "mcp" | "agents";
const CATEGORIES: readonly { id: Area; label: string }[] = [
  { id: "plugins", label: "插件" },
  { id: "skills", label: "技能" },
  { id: "apps", label: "应用" },
  { id: "mcp", label: "MCP" },
  { id: "agents", label: "Agents" },
];
const categories: readonly { id: string; label: string }[] = [
  { id: "", label: "全部" },
  { id: "office", label: "办公" },
  { id: "creative", label: "创作" },
  { id: "design_and_sites", label: "设计与网站" },
  { id: "code", label: "代码" },
  { id: "business", label: "商业" },
  { id: "sales", label: "销售" },
  { id: "productivity", label: "效率" },
  { id: "science_and_healthcare", label: "科学与医疗" },
  { id: "education", label: "教育" },
  { id: "other", label: "其他" },
];
const MARKETPLACE_CATEGORY: Readonly<Record<string, number>> = {
  other: MarketplaceCategory.OTHER,
  office: MarketplaceCategory.OFFICE,
  creative: MarketplaceCategory.STUDIO,
  design_and_sites: MarketplaceCategory.DESIGN_AND_SITES,
  code: MarketplaceCategory.CODE,
  business: MarketplaceCategory.BUSINESS,
  sales: MarketplaceCategory.SALES,
  productivity: MarketplaceCategory.PRODUCTIVITY,
  science_and_healthcare: MarketplaceCategory.SCIENCE_AND_HEALTHCARE,
  education: MarketplaceCategory.EDUCATION,
};
const read = (row: Row, ...keys: string[]): string => {
  for (const key of keys)
    if (typeof row[key] === "string") return row[key] as string;
  return "";
};
const rows = (value: unknown, key: string): Row[] => {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value))
    return value.filter(
      (item): item is Row => !!item && typeof item === "object",
    );
  const found = (value as Row)[key];
  return Array.isArray(found)
    ? found.filter((item): item is Row => !!item && typeof item === "object")
    : [];
};

export function PluginManagement({
  transport,
  onClose,
  initialArea = "plugins",
}: {
  readonly transport?: WebuiTransport;
  readonly onClose: () => void;
  readonly initialArea?: Area;
}): ReactElement {
  const [area, setArea] = useState<Area>(initialArea);
  const [view, setView] = useState<"market" | "personal">("market");
  const [managementOpen, setManagementOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [data, setData] = useState<Row[]>([]);
  const [marketSkills, setMarketSkills] = useState<Row[]>([]);
  const [personalSkills, setPersonalSkills] = useState<Row[]>([]);
  const [marketPluginTotal, setMarketPluginTotal] = useState(0);
  const [showAllPlugins, setShowAllPlugins] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"mcp" | "agent" | "skill" | null>(null);
  const [editing, setEditing] = useState<Row | undefined>();
  const [selectedAgent, setSelectedAgent] = useState<Row | undefined>();
  const [mcpName, setMcpName] = useState("");
  const [mcpTransport, setMcpTransport] = useState("stdio");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpDescription, setMcpDescription] = useState("");
  const [mcpJsonMode, setMcpJsonMode] = useState(false);
  const [mcpJson, setMcpJson] = useState("{}");
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentModel, setAgentModel] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillContent, setSkillContent] = useState("");
  const [pluginUrl, setPluginUrl] = useState("");
  const [pluginPreview, setPluginPreview] = useState<Row | undefined>();
  const [pluginImportDialog, setPluginImportDialog] = useState(false);

  const request = async (
    action: WebuiPluginManagementAction,
    input?: Row,
  ): Promise<unknown> => {
    if (!transport?.pluginManagement)
      throw new Error("Plugin management is not connected to the runtime");
    return transport.pluginManagement({
      action,
      ...(input ? { input } : {}),
    });
  };
  const reload = async () => {
    setBusy(true);
    setError("");
    try {
      let result: unknown;
      if (area === "plugins" && view === "market") {
        const [market, installed] = await Promise.all([
          request("listMarketplacePlugins", {
            source: InstalledPluginSource.OFFICIAL,
            limit: 100,
            skillLimit: 8,
            keyword: query || undefined,
            category: category ? MARKETPLACE_CATEGORY[category] : undefined,
          }),
          request("listInstalledPlugins", { limit: 200 }),
        ]);
        const installedNames = new Set(
          rows(installed, "plugins")
            .filter((item) => item.source === InstalledPluginSource.OFFICIAL)
            .map((item) => nameOf(item).toLowerCase()),
        );
        result = {
          plugins: rows(market, "plugins").map((item) => ({
            ...item,
            installed:
              item.installed === true ||
              installedNames.has(nameOf(item).toLowerCase()),
          })),
        };
        setMarketSkills(rows(market, "marketplaceSkills").slice(0, 8));
        setMarketPluginTotal(
          typeof (market as Row)?.pluginTotal === "number"
            ? ((market as Row).pluginTotal as number)
            : rows(market, "plugins").length,
        );
        setPersonalSkills([]);
      } else if (area === "plugins") {
        if (view === "personal") {
          const [installed, marketplace, skills] = await Promise.all([
            request("listInstalledPlugins", {
              limit: 100,
              keyword: query || undefined,
            }),
            request("listMarketplacePlugins", { limit: 100 }),
            request("listRuntimeSkills", {}),
          ]);
          const marketplaceIcons = new Map(
            rows(marketplace, "plugins").flatMap((item) => {
              const icon = read(item, "iconUrl", "icon_url");
              return [
                nameOf(item).toLocaleLowerCase(),
                read(item, "displayName", "display_name").toLocaleLowerCase(),
              ]
                .filter(Boolean)
                .map((name) => [name, icon] as const);
            }),
          );
          result = {
            plugins: rows(installed, "plugins").map((item) => ({
              ...item,
              iconUrl:
                marketplaceIcons.get(nameOf(item).toLocaleLowerCase()) ||
                marketplaceIcons.get(
                  read(item, "displayName", "display_name").toLocaleLowerCase(),
                ) ||
                read(item, "iconUrl", "icon_url"),
            })),
          };
          setPersonalSkills(rows(skills, "skills"));
          setMarketSkills([]);
        } else
          result = await request("listInstalledPlugins", {
            limit: 100,
            keyword: query || undefined,
          });
      } else if (area === "skills")
        result =
          view === "market"
            ? await request("listSkillHub", {
                limit: 100,
                keyword: query || undefined,
              })
            : await request("listRuntimeSkills", {});
      else if (area === "apps") result = await request("listApps");
      else if (area === "mcp")
        result = await request("listMcpServers", {
          keyword: query || undefined,
        });
      else
        result = await request("listAgents", {
          limit: 100,
          search: query || undefined,
          include: "identity,persona,system_prompt",
        });
      const key =
        area === "plugins"
          ? "plugins"
          : area === "skills"
            ? "skills"
            : area === "apps"
              ? "miniApps"
              : area === "mcp"
                ? "servers"
                : "agents";
      setData(rows(result, key));
      if (area !== "plugins") {
        setMarketSkills([]);
        setPersonalSkills([]);
      }
      if (area === "agents") setSelectedAgent(rows(result, key)[0]);
    } catch (cause) {
      setData([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void reload();
  }, [area, view, query, category]);
  const filtered = useMemo(
    () =>
      data.filter(
        (item) =>
          !query ||
          `${read(item, "name", "displayName", "display_name")} ${read(item, "description")}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      ),
    [data, query],
  );
  const mutate = async (
    action: WebuiPluginManagementAction,
    input: Row,
  ): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await request(action, input);
      await reload();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const confirmMutation = (
    label: string,
    action: WebuiPluginManagementAction,
    input: Row,
  ) => {
    if (window.confirm(`确定${label}？此操作会立即影响本地配置。`))
      void mutate(action, input);
  };
  const nameOf = (item: Row) =>
    read(
      item,
      "name",
      "pluginName",
      "plugin_name",
      "pluginId",
      "displayName",
      "display_name",
    );
  const pluginSource = (item: Row) =>
    typeof item.source === "number" ? item.source : undefined;
  const enabled = (item: Row) =>
    item.enabled === true ||
    item.isEnabled === true ||
    item.is_enabled === true;
  const appStatus = (item: Row) => {
    const runtime =
      item.runtime && typeof item.runtime === "object"
        ? (item.runtime as Row)
        : {};
    const status = read(runtime, "status");
    return status === "running"
      ? "运行中"
      : status === "starting"
        ? "启动中"
        : status === "stopping"
          ? "停止中"
          : status === "failed"
            ? "启动失败"
            : status === "stopped"
              ? "已停止"
              : "未知状态";
  };

  const beginMcp = (item?: Row) => {
    setEditing(item);
    setMcpName(nameOf(item ?? {}));
    const config = (
      item?.config && typeof item.config === "object" ? item.config : {}
    ) as Row;
    setMcpDescription(
      read(config, "description") || read(item ?? {}, "description"),
    );
    const method = read(config, "transport", "type") || "stdio";
    setMcpTransport(method);
    setMcpCommand(read(config, "command"));
    setMcpArgs(Array.isArray(config.args) ? config.args.join(" ") : "");
    setMcpUrl(read(config, "url"));
    setMcpJson(JSON.stringify(config, null, 2));
    setMcpJsonMode(false);
    setDialog("mcp");
  };
  const prepareMcp = async (item?: Row) => {
    if (!item) {
      beginMcp();
      return;
    }
    try {
      const detail = await request("getMcpServer", { name: nameOf(item) });
      beginMcp((detail && typeof detail === "object" ? detail : item) as Row);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const saveMcp = async () => {
    let config: Row;
    if (mcpJsonMode) {
      try {
        const parsed: unknown = JSON.parse(mcpJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("JSON 配置必须是对象");
        config = parsed as Row;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
    } else
      config = {
        transport: mcpTransport,
        description: mcpDescription,
        ...(mcpTransport === "stdio"
          ? { command: mcpCommand, args: mcpArgs.split(/\s+/u).filter(Boolean) }
          : { url: mcpUrl }),
      };
    if (
      await mutate(editing ? "updateMcpServer" : "createMcpServer", {
        name: mcpName.trim(),
        config,
        enabled: true,
      })
    )
      setDialog(null);
  };
  const beginAgent = (item?: Row) => {
    setEditing(item);
    setAgentName(read(item ?? {}, "name", "displayName", "display_name"));
    setAgentDescription(read(item ?? {}, "description"));
    setAgentPrompt(read(item ?? {}, "systemPrompt", "system_prompt"));
    setAgentModel(read(item ?? {}, "model"));
    setDialog("agent");
  };
  const saveAgent = async () => {
    const input = editing
      ? {
          name: nameOf(editing),
          displayName: agentName.trim(),
          description: agentDescription.trim(),
          systemPrompt: agentPrompt,
        }
      : {
          name: agentName.trim(),
          displayName: agentName.trim(),
          description: agentDescription.trim(),
          systemPrompt: agentPrompt,
          initialDefinition: {
            name: agentName.trim(),
            description: agentDescription.trim(),
            ...(agentModel.trim() ? { model: agentModel.trim() } : {}),
            systemPrompt: agentPrompt,
          },
        };
    if (await mutate(editing ? "updateAgent" : "createAgent", input))
      setDialog(null);
  };
  const saveSkill = async () => {
    if (
      await mutate("createSkill", {
        name: agentName.trim(),
        description: skillDescription.trim(),
        content: skillContent,
      })
    ) {
      setAgentName("");
      setDialog(null);
    }
  };
  const previewPlugin = async () => {
    try {
      setBusy(true);
      setError("");
      const result = await request("previewGithubPlugin", {
        url: pluginUrl.trim(),
      });
      setPluginPreview(result as Row);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const importPlugin = async () => {
    const source = pluginPreview?.source;
    if (!source || typeof source !== "object") return;
    if (await mutate("importGithubPlugin", { source: source as Row })) {
      setPluginImportDialog(false);
      setPluginPreview(undefined);
    }
  };

  const openCreate = (target: Area) => {
    setArea(target);
    setView("personal");
    setManagementOpen(true);
    setCreateMenuOpen(false);
    if (target === "mcp") beginMcp();
    else if (target === "agents") beginAgent();
    else {
      setEditing(undefined);
      setAgentName("");
      setSkillDescription("");
      setSkillContent("");
      setDialog("skill");
    }
  };

  return (
    <section
      className={`webui-plugin-management ${managementOpen ? "is-managing" : "is-marketplace"}`}
      data-testid="plugin-management"
    >
      <header className="webui-plugin-header">
        {managementOpen ? (
          <>
            <button
              type="button"
              onClick={() => {
                setManagementOpen(false);
                setArea("plugins");
                setView("market");
              }}
              aria-label="返回"
            >
              ‹ 插件
            </button>
            <h1>管理</h1>
            <div className="webui-plugin-header-tabs">
              <button
                aria-pressed={view === "market"}
                onClick={() => setView("market")}
              >
                市场
              </button>
              <button
                aria-pressed={view === "personal"}
                onClick={() => setView("personal")}
              >
                个人
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="webui-plugin-header-tabs">
              <button
                aria-pressed={view === "market"}
                onClick={() => setView("market")}
              >
                市场
              </button>
              <button
                aria-pressed={view === "personal"}
                onClick={() => setView("personal")}
              >
                个人
              </button>
            </div>
            <div className="webui-plugin-create-anchor">
              <button
                type="button"
                aria-label="刷新插件市场"
                onClick={() => void reload()}
              >
                ⟳
              </button>
              <button
                type="button"
                onClick={() => {
                  setManagementOpen(true);
                  setView("personal");
                }}
              >
                管理
              </button>
              <button
                type="button"
                className="webui-plugin-create-trigger"
                aria-expanded={createMenuOpen}
                onClick={() => setCreateMenuOpen((open) => !open)}
              >
                ＋ 创建
              </button>
              {createMenuOpen ? (
                <div className="webui-plugin-create-menu">
                  <button
                    onClick={() => {
                      setPluginImportDialog(true);
                      setCreateMenuOpen(false);
                      setPluginUrl("");
                      setPluginPreview(undefined);
                    }}
                  >
                    从 Git 仓库导入插件
                  </button>
                  <button onClick={() => openCreate("skills")}>录入技能</button>
                  <button onClick={() => openCreate("mcp")}>
                    添加 MCP server
                  </button>
                  <button onClick={() => openCreate("agents")}>
                    创建 Agent
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
        <button
          type="button"
          className="webui-plugin-close"
          aria-label="关闭插件管理"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {managementOpen ? (
        <nav className="webui-plugin-categories" aria-label="插件管理分类">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              aria-pressed={area === item.id}
              onClick={() => {
                setArea(item.id);
                if (
                  item.id === "mcp" ||
                  item.id === "agents" ||
                  item.id === "apps"
                )
                  setView("personal");
              }}
            >
              <span>{item.label}</span>
              {area === item.id ? (
                <span className="webui-plugin-count">{data.length}</span>
              ) : null}
            </button>
          ))}
          <input
            aria-label="搜索"
            placeholder={`搜索${area === "mcp" ? "MCP" : area === "skills" ? "技能" : area === "agents" ? "Agent" : area === "apps" ? "应用" : "插件"}`}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </nav>
      ) : null}
      {area === "plugins" && view === "market" ? (
        <div className="webui-plugin-market-discovery">
          <nav className="webui-plugin-category-filter" aria-label="市场分类">
            {categories.map((item) => (
              <button
                key={item.id}
                aria-pressed={category === item.id}
                onClick={() => {
                  setShowAllPlugins(false);
                  setCategory(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <input
            aria-label="搜索插件或技能"
            placeholder="搜索插件或技能..."
            value={query}
            onChange={(event) => {
              setShowAllPlugins(false);
              setQuery(event.currentTarget.value);
            }}
          />
        </div>
      ) : null}
      {area === "plugins" && view === "market" ? (
        <h2 className="webui-plugin-market-heading">插件</h2>
      ) : null}
      {area === "plugins" && view === "personal" && !managementOpen ? (
        <h2 className="webui-plugin-market-heading">插件</h2>
      ) : null}
      {area === "mcp" ? (
        <div className="webui-plugin-toolbar">
          <button type="button" onClick={() => beginMcp()}>
            ＋ 添加服务器
          </button>
        </div>
      ) : null}
      {area === "agents" ? (
        <div className="webui-plugin-toolbar">
          <button type="button" onClick={() => beginAgent()}>
            ＋ 创建 Agent
          </button>
        </div>
      ) : null}
      {area === "skills" && view === "personal" ? (
        <div className="webui-plugin-toolbar">
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setAgentName("");
              setSkillDescription("");
              setSkillContent("");
              setDialog("skill");
            }}
          >
            ＋ 录入技能
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="webui-plugin-error">
          {error}
        </p>
      ) : null}
      {busy ? (
        <p className="webui-plugin-empty" role="status">
          加载中…
        </p>
      ) : area === "agents" ? (
        <div className="webui-agent-editor">
          <div className="webui-agent-list">
            {filtered.map((item) => (
              <button
                key={nameOf(item)}
                aria-pressed={selectedAgent === item}
                onClick={() => setSelectedAgent(item)}
              >
                {nameOf(item)}
              </button>
            ))}
          </div>
          {selectedAgent ? (
            <div className="webui-agent-detail">
              <h2>{nameOf(selectedAgent)}</h2>
              <p>{read(selectedAgent, "description")}</p>
              <pre>{read(selectedAgent, "systemPrompt", "system_prompt")}</pre>
              <div className="webui-plugin-actions">
                <button onClick={() => beginAgent(selectedAgent)}>编辑</button>
                <button
                  onClick={() =>
                    confirmMutation("删除 Agent", "deleteAgent", {
                      name: nameOf(selectedAgent),
                    })
                  }
                >
                  删除
                </button>
              </div>
            </div>
          ) : (
            <p className="webui-plugin-empty">暂无 Agent</p>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <p className="webui-plugin-empty">暂无内容</p>
      ) : (
        <div
          className={`webui-plugin-list ${area === "plugins" && view === "market" ? "webui-plugin-grid" : ""}`}
        >
          {(area === "plugins" && view === "market" && !showAllPlugins
            ? filtered.slice(0, 8)
            : filtered
          ).map((item, index) => {
            const name = nameOf(item) || `item-${index}`;
            const isOn = enabled(item);
            const description = read(item, "description", "summary");
            const action =
              area === "plugins"
                ? view === "market"
                  ? "installPlugin"
                  : isOn
                    ? "disablePlugin"
                    : "enablePlugin"
                : area === "skills"
                  ? view === "market"
                    ? "installSkill"
                    : "setSkillEnabled"
                  : "setMcpServerEnabled";
            const iconUrl = read(item, "iconUrl", "icon_url");
            return (
              <article className="webui-plugin-row" key={`${area}-${name}`}>
                <div className="webui-plugin-icon" aria-hidden="true">
                  {iconUrl ? (
                    <>
                      <img
                        src={iconUrl}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                          event.currentTarget.nextElementSibling?.removeAttribute(
                            "hidden",
                          );
                        }}
                      />
                      <span hidden>▦</span>
                    </>
                  ) : area === "plugins" ? (
                    "▦"
                  ) : area === "skills" ? (
                    "▤"
                  ) : (
                    "◇"
                  )}
                </div>
                <div className="webui-plugin-copy">
                  <h2>{read(item, "displayName", "display_name") || name}</h2>
                  <p>{description || read(item, "transport")}</p>
                </div>
                {area === "plugins" && view === "market" ? (
                  <button
                    type="button"
                    disabled={item.installed === true}
                    onClick={() =>
                      void mutate(action, {
                        pluginName: name,
                        source: pluginSource(item),
                      })
                    }
                  >
                    {item.installed === true ? "已安装" : "安装"}
                  </button>
                ) : area === "skills" && view === "market" ? (
                  <button
                    type="button"
                    disabled={
                      item.added === true ||
                      !read(
                        item,
                        "url",
                        "sourceUrl",
                        "source_url",
                        "gitUrl",
                        "git_url",
                      )
                    }
                    onClick={() =>
                      void mutate("installSkill", {
                        url:
                          read(item, "url", "sourceUrl", "source_url") ||
                          read(item, "gitUrl", "git_url"),
                        displayName:
                          read(item, "displayName", "display_name") ||
                          undefined,
                        publisherSourceType:
                          typeof item.publisherSourceType === "number"
                            ? item.publisherSourceType
                            : typeof item.source_type === "number"
                              ? item.source_type
                              : undefined,
                        isFromGit:
                          item.isFromGit === true || item.is_from_git === true,
                        ...(item.creatorInfo &&
                        typeof item.creatorInfo === "object"
                          ? { creatorInfo: item.creatorInfo }
                          : item.creator_info &&
                              typeof item.creator_info === "object"
                            ? { creatorInfo: item.creator_info }
                            : {}),
                      })
                    }
                  >
                    {item.added === true ? "已添加" : "添加"}
                  </button>
                ) : area === "apps" ? (
                  <span className="text-text_default_tertiary">
                    {appStatus(item)}
                  </span>
                ) : area === "mcp" ? (
                  <div className="webui-plugin-actions">
                    <button onClick={() => void prepareMcp(item)}>编辑</button>
                    <button
                      onClick={() =>
                        confirmMutation("删除 MCP server", "deleteMcpServer", {
                          name,
                        })
                      }
                    >
                      删除
                    </button>
                    <button
                      role="switch"
                      aria-checked={isOn}
                      aria-label={`启用 ${name}`}
                      onClick={() =>
                        void mutate(action, { name, enabled: !isOn })
                      }
                    >
                      <span />
                    </button>
                  </div>
                ) : (
                  <div className="webui-plugin-actions">
                    <button
                      role="switch"
                      aria-checked={isOn}
                      aria-label={`启用 ${name}`}
                      onClick={() =>
                        void mutate(
                          action,
                          area === "plugins"
                            ? { pluginName: name, source: pluginSource(item) }
                            : {
                                skillName: name,
                                enabled: !isOn,
                                ...(item.locationUri
                                  ? { locationUri: item.locationUri }
                                  : {}),
                              },
                        )
                      }
                    >
                      <span />
                    </button>
                    {area === "plugins" ? (
                      <button
                        onClick={() =>
                          confirmMutation("卸载插件", "uninstallPlugin", {
                            pluginName: name,
                            source: pluginSource(item),
                          })
                        }
                      >
                        卸载
                      </button>
                    ) : area === "skills" ? (
                      <button
                        onClick={() =>
                          confirmMutation("删除技能", "deleteSkill", {
                            skillName: name,
                            ...(item.locationUri
                              ? { locationUri: item.locationUri }
                              : {}),
                          })
                        }
                      >
                        删除
                      </button>
                    ) : null}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {!busy && area === "plugins" && view === "market" ? (
        <>
          {marketPluginTotal > 8 ? (
            <button
              type="button"
              className="webui-plugin-show-all"
              onClick={() => setShowAllPlugins((value) => !value)}
            >
              {showAllPlugins ? "收起插件" : `查看全部 ${marketPluginTotal} 个`}
            </button>
          ) : null}
          <section className="webui-plugin-market-skills">
            <h2 className="webui-plugin-market-heading">技能</h2>
            <div className="webui-plugin-market-skill-grid">
              {marketSkills.map((item) => {
                const name = nameOf(item);
                const url = read(item, "url", "sourceUrl", "source_url");
                return (
                  <article key={`hub-skill-${name}`}>
                    <div aria-hidden="true">▤</div>
                    <h3>{read(item, "displayName", "display_name") || name}</h3>
                    <p>
                      {read(item, "creatorName", "creator_name") ||
                        "@MiniMax Code"}
                    </p>
                    <button
                      type="button"
                      disabled={item.added === true || !url}
                      onClick={() =>
                        void mutate("installSkill", {
                          url,
                          displayName:
                            read(item, "displayName", "display_name") ||
                            undefined,
                          publisherSourceType:
                            typeof item.publisherSourceType === "number"
                              ? item.publisherSourceType
                              : typeof item.sourceType === "number"
                                ? item.sourceType
                                : undefined,
                          isFromGit:
                            item.isFromGit === true ||
                            item.is_from_git === true,
                          ...(item.creatorInfo &&
                          typeof item.creatorInfo === "object"
                            ? { creatorInfo: item.creatorInfo }
                            : {}),
                        })
                      }
                    >
                      {item.added === true ? "已添加" : "添加"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
      {!busy && area === "plugins" && view === "personal" ? (
        <section className="webui-plugin-market-skills webui-plugin-personal-skills">
          <h2 className="webui-plugin-market-heading">技能</h2>
          {personalSkills.map((item) => {
            const name = nameOf(item);
            const isOn = enabled(item);
            return (
              <article key={`personal-skill-${name}`}>
                <span>{read(item, "displayName", "display_name") || name}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  aria-label={`启用 ${name}`}
                  onClick={() =>
                    void mutate("setSkillEnabled", {
                      skillName: name,
                      enabled: !isOn,
                      ...(item.locationUri
                        ? { locationUri: item.locationUri }
                        : {}),
                    })
                  }
                >
                  {isOn ? "使用中" : "使用"}
                </button>
              </article>
            );
          })}
        </section>
      ) : null}
      {dialog ? (
        <div
          className="webui-plugin-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <section
            className="webui-plugin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugin-dialog-title"
          >
            <header>
              <div>
                <h2 id="plugin-dialog-title">
                  {dialog === "mcp"
                    ? editing
                      ? "编辑 MCP server"
                      : "添加 MCP server"
                    : dialog === "skill"
                      ? "录入技能"
                      : editing
                        ? "编辑 Agent"
                        : "创建 Agent"}
                </h2>
                <p>配置 MiniMax Code 如何连接到该项</p>
              </div>
              <button onClick={() => setDialog(null)} aria-label="关闭">
                ×
              </button>
            </header>
            {dialog === "mcp" ? (
              <>
                <div className="webui-plugin-header-tabs">
                  <button
                    aria-pressed={!mcpJsonMode}
                    onClick={() => setMcpJsonMode(false)}
                  >
                    表单
                  </button>
                  <button
                    aria-pressed={mcpJsonMode}
                    onClick={() => setMcpJsonMode(true)}
                  >
                    JSON
                  </button>
                </div>
                {mcpJsonMode ? (
                  <label className="wide">
                    MCP 配置 JSON
                    <textarea
                      className="webui-plugin-json"
                      value={mcpJson}
                      onChange={(event) =>
                        setMcpJson(event.currentTarget.value)
                      }
                      spellCheck={false}
                    />
                  </label>
                ) : (
                  <div className="webui-plugin-form">
                    <label>
                      Server 名称
                      <input
                        value={mcpName}
                        onChange={(event) =>
                          setMcpName(event.currentTarget.value)
                        }
                        placeholder="my-server"
                      />
                    </label>
                    <label>
                      传输方式
                      <select
                        value={mcpTransport}
                        onChange={(event) =>
                          setMcpTransport(event.currentTarget.value)
                        }
                      >
                        <option value="stdio">stdio</option>
                        <option value="streamable-http">HTTP</option>
                        <option value="sse">SSE</option>
                      </select>
                    </label>
                    {mcpTransport === "stdio" ? (
                      <>
                        <label>
                          命令
                          <input
                            value={mcpCommand}
                            onChange={(event) =>
                              setMcpCommand(event.currentTarget.value)
                            }
                            placeholder="npx"
                          />
                        </label>
                        <label>
                          参数
                          <input
                            value={mcpArgs}
                            onChange={(event) =>
                              setMcpArgs(event.currentTarget.value)
                            }
                            placeholder="-y @example/mcp-server"
                          />
                        </label>
                      </>
                    ) : (
                      <label>
                        URL
                        <input
                          value={mcpUrl}
                          onChange={(event) =>
                            setMcpUrl(event.currentTarget.value)
                          }
                          placeholder="https://example.com/mcp"
                        />
                      </label>
                    )}
                    <label className="wide">
                      描述
                      <input
                        value={mcpDescription}
                        onChange={(event) =>
                          setMcpDescription(event.currentTarget.value)
                        }
                      />
                    </label>
                  </div>
                )}
              </>
            ) : dialog === "skill" ? (
              <div className="webui-plugin-form">
                <label>
                  名称
                  <input
                    value={agentName}
                    onChange={(event) =>
                      setAgentName(event.currentTarget.value)
                    }
                    placeholder="my-skill"
                  />
                </label>
                <label className="wide">
                  描述
                  <input
                    value={skillDescription}
                    onChange={(event) =>
                      setSkillDescription(event.currentTarget.value)
                    }
                  />
                </label>
                <label className="wide">
                  技能内容
                  <textarea
                    value={skillContent}
                    onChange={(event) =>
                      setSkillContent(event.currentTarget.value)
                    }
                    placeholder="编写技能指令"
                  />
                </label>
              </div>
            ) : (
              <div className="webui-plugin-form">
                <label>
                  名称
                  <input
                    value={agentName}
                    onChange={(event) =>
                      setAgentName(event.currentTarget.value)
                    }
                    placeholder="my-agent"
                  />
                </label>
                <label className="wide">
                  介绍
                  <input
                    value={agentDescription}
                    onChange={(event) =>
                      setAgentDescription(event.currentTarget.value)
                    }
                  />
                </label>
                {!editing ? (
                  <label className="wide">
                    模型 ID
                    <input
                      value={agentModel}
                      onChange={(event) =>
                        setAgentModel(event.currentTarget.value)
                      }
                      placeholder="provider/model-name"
                    />
                  </label>
                ) : null}
                <label className="wide">
                  系统提示词
                  <textarea
                    value={agentPrompt}
                    onChange={(event) =>
                      setAgentPrompt(event.currentTarget.value)
                    }
                    placeholder="输入系统提示词"
                  />
                </label>
              </div>
            )}
            <footer>
              <button onClick={() => setDialog(null)}>取消</button>
              <button
                disabled={
                  busy ||
                  (dialog === "mcp"
                    ? !mcpName.trim() ||
                      (!mcpJsonMode &&
                        (mcpTransport === "stdio"
                          ? !mcpCommand.trim()
                          : !mcpUrl.trim()))
                    : dialog === "skill"
                      ? !agentName.trim() || !skillContent.trim()
                      : !agentName.trim())
                }
                onClick={() =>
                  void (dialog === "mcp"
                    ? saveMcp()
                    : dialog === "skill"
                      ? saveSkill()
                      : saveAgent())
                }
              >
                保存
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {pluginImportDialog ? (
        <div
          className="webui-plugin-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setPluginImportDialog(false);
          }}
        >
          <section
            className="webui-plugin-dialog webui-plugin-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugin-import-title"
          >
            <header>
              <div>
                <h2 id="plugin-import-title">从 Git 仓库导入插件</h2>
                <p>输入 GitHub 插件仓库或子目录 URL</p>
              </div>
              <button
                onClick={() => setPluginImportDialog(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </header>
            <div className="webui-plugin-import-body">
              <label>
                仓库 URL
                <input
                  aria-label="仓库 URL"
                  value={pluginUrl}
                  onChange={(event) => {
                    setPluginUrl(event.currentTarget.value);
                    setPluginPreview(undefined);
                  }}
                  placeholder="https://github.com/owner/repository"
                />
              </label>
              {pluginPreview ? (
                <div className="webui-plugin-import-preview">
                  <strong>
                    {read(
                      ((pluginPreview.plugin as Row)?.summary as Row) || {},
                      "displayName",
                      "name",
                    )}
                  </strong>
                  <p>
                    {read(
                      ((pluginPreview.plugin as Row)?.summary as Row) || {},
                      "description",
                    )}
                  </p>
                  <span>
                    技能{" "}
                    {String((pluginPreview.plugin as Row)?.skillCount ?? 0)} ·
                    MCP{" "}
                    {String((pluginPreview.plugin as Row)?.mcpServerCount ?? 0)}
                  </span>
                  {pluginPreview.canImport !== true ? (
                    <ul className="webui-plugin-diagnostics" role="status">
                      {Array.isArray(pluginPreview.diagnostics) &&
                      pluginPreview.diagnostics.length > 0 ? (
                        (pluginPreview.diagnostics as Row[]).map(
                          (diagnostic, index) => (
                            <li key={`${read(diagnostic, "code")}-${index}`}>
                              {[
                                read(diagnostic, "code"),
                                read(diagnostic, "capability", "name"),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </li>
                          ),
                        )
                      ) : (
                        <li>当前插件包还不能导入，请检查仓库内容后重试。</li>
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="webui-plugin-error">
                {error}
              </p>
            ) : null}
            <footer>
              <button onClick={() => setPluginImportDialog(false)}>取消</button>
              {pluginPreview ? (
                <button
                  disabled={busy || pluginPreview.canImport !== true}
                  onClick={() => void importPlugin()}
                >
                  导入插件
                </button>
              ) : (
                <button
                  disabled={busy || !pluginUrl.trim()}
                  onClick={() => void previewPlugin()}
                >
                  预览
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
