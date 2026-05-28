import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./app.module.css";

interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  image: string;
  category: string;
  description: string;
}

function parseCatalog(result: CallToolResult): Product[] {
  for (const block of result.content ?? []) {
    if (block.type === "text") {
      try {
        const parsed = JSON.parse(block.text);
        if (Array.isArray(parsed?.products)) {
          return parsed.products as Product[];
        }
      } catch {
        // not the JSON block; keep scanning
      }
    }
  }
  return [];
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function ProductPicker() {
  const [products, setProducts] = useState<Product[]>([]);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Product Picker", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = async (result) => {
        setProducts(parseCatalog(result));
      };
      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
      app.onerror = console.error;
    },
  });

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  if (error) return <div className={styles.status}><strong>Error:</strong> {error.message}</div>;
  if (!app) return <div className={styles.status}>Connecting…</div>;

  return <PickerInner app={app} products={products} hostContext={hostContext} />;
}

interface PickerInnerProps {
  app: App;
  products: Product[];
  hostContext?: McpUiHostContext;
}

function PickerInner({ app, products, hostContext }: PickerInnerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { count, total, currency } = useMemo(() => {
    const chosen = products.filter((p) => selected.has(p.id));
    const total = chosen.reduce((sum, p) => sum + p.price, 0);
    return { count: chosen.length, total, currency: chosen[0]?.currency ?? "USD" };
  }, [products, selected]);

  const handleConfirm = useCallback(async () => {
    const chosen = products.filter((p) => selected.has(p.id));
    if (chosen.length === 0) return;
    setSubmitting(true);
    try {
      await app.callServerTool({
        name: "confirm-selection",
        arguments: { productIds: chosen.map((p) => p.id) },
      });
      const lines = chosen.map((p) => `- ${p.name} (${formatMoney(p.price, p.currency)})`);
      await app.sendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: `I selected ${chosen.length} product(s):\n${lines.join("\n")}\n\nTotal: ${formatMoney(total, currency)}`,
          },
        ],
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }, [app, products, selected, total, currency]);

  return (
    <main
      className={styles.main}
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      {products.length === 0 ? (
        <div className={styles.status}>Loading products…</div>
      ) : (
        <div className={styles.grid}>
          {products.map((p) => {
            const isSelected = selected.has(p.id);
            return (
              <div
                key={p.id}
                className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`}
                onClick={() => toggle(p.id)}
                role="button"
                aria-pressed={isSelected}
              >
                <img className={styles.thumb} src={p.image} alt={p.name} />
                <div className={styles.cardBody}>
                  <span className={styles.category}>{p.category}</span>
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.desc}>{p.description}</span>
                  <div className={styles.priceRow}>
                    <span className={styles.price}>{formatMoney(p.price, p.currency)}</span>
                    <input
                      className={styles.check}
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${p.name}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.summary}>
          {count} selected · {formatMoney(total, currency)}
        </span>
        <button
          className={styles.confirm}
          disabled={count === 0 || submitting}
          onClick={handleConfirm}
        >
          {submitting ? "Adding…" : "Add selection to chat"}
        </button>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProductPicker />
  </StrictMode>,
);
