import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import type { Notice, NoticeEntity } from "@/lib/types";
import { gql } from "@/lib/utils";
import { useAuth } from "./useAuth";

const NOTICES_QUERY = `
  query GetNotices {
    notices {
      id entityType entityId kind createdAt
      by { id name }
    }
  }
`;
const ACKNOWLEDGE_MUTATION = `mutation AcknowledgeNotice($id: ID!) { acknowledgeNotice(id: $id) }`;
const PENDING_NEWS_QUERY = `query GetPendingNews { pendingNews }`;
const MARK_PENDING_SEEN_MUTATION = `mutation MarkPendingSeen($section: String!) { markPendingSeen(section: $section) }`;

interface NoticesContextType {
  /** El aviso sin ver sobre un elemento, si hay */
  noticeFor: (entityType: NoticeEntity, entityId: string) => Notice | undefined;
  /** Si hay algun aviso sin ver en una seccion (para el punto del menu) */
  hasNotices: (entityType: NoticeEntity) => boolean;
  /** Lo marca como visto: se desfija de la lista */
  acknowledge: (id: string) => Promise<void>;
  /** Si llegaron pedidos pendientes que todavia no miraste (solo staff) */
  hasNewPending: (section: NoticeEntity) => boolean;
  /** Ya miraste los pendientes de la seccion: se apaga su punto */
  markPendingSeen: (section: NoticeEntity) => void;
}

// Sin provider (por ejemplo en el panel de administracion) no hay avisos
const EMPTY: NoticesContextType = {
  noticeFor: () => undefined,
  hasNotices: () => false,
  acknowledge: async () => {},
  hasNewPending: () => false,
  markPendingSeen: () => {},
};

const NoticesContext = createContext<NoticesContextType>(EMPTY);

const key = (entityType: NoticeEntity, entityId: string) => `${entityType}:${entityId}`;

// Los avisos se vuelven a pedir al cambiar de pagina o de usuario: los provoca
// otra persona, asi que no hay una accion propia despues de la cual refrescar
export function NoticesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [pendingNews, setPendingNews] = useState<NoticeEntity[]>([]);
  // Marcar como vistos los pendientes descarta las consultas que ya estaban en
  // camino: se calcularon antes y volverian a prender el punto
  const pendingRequest = useRef(0);

  // Solo vale la respuesta de la ultima consulta
  const loadPendingNews = useCallback(() => {
    const request = ++pendingRequest.current;
    gql<{ pendingNews: NoticeEntity[] }>(PENDING_NEWS_QUERY)
      .then((data) => {
        if (request === pendingRequest.current) setPendingNews(data.pendingNews);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      pendingRequest.current++;
      setNotices([]);
      setPendingNews([]);
      return;
    }
    let cancelled = false;
    // Si falla no se rompe nada: se reintenta en la proxima navegacion
    gql<{ notices: Notice[] }>(NOTICES_QUERY)
      .then((data) => {
        if (!cancelled) setNotices(data.notices);
      })
      .catch(() => {});
    loadPendingNews();
    return () => {
      cancelled = true;
    };
  }, [user, pathname, loadPendingNews]);

  const acknowledge = useCallback(async (id: string) => {
    await gql(ACKNOWLEDGE_MUTATION, { id });
    setNotices((current) => current.filter((n) => n.id !== id));
  }, []);

  // Se apaga en el momento; despues se vuelve a consultar con lo ya marcado
  const markPendingSeen = useCallback(
    (section: NoticeEntity) => {
      pendingRequest.current++;
      setPendingNews((current) => current.filter((s) => s !== section));
      gql(MARK_PENDING_SEEN_MUTATION, { section })
        .then(loadPendingNews)
        .catch(() => {});
    },
    [loadPendingNews],
  );

  const value = useMemo<NoticesContextType>(() => {
    const byEntity = new Map(notices.map((n) => [key(n.entityType, n.entityId), n]));
    const sections = new Set(notices.map((n) => n.entityType));
    const pending = new Set(pendingNews);
    return {
      noticeFor: (entityType, entityId) => byEntity.get(key(entityType, entityId)),
      hasNotices: (entityType) => sections.has(entityType),
      acknowledge,
      hasNewPending: (section) => pending.has(section),
      markPendingSeen,
    };
  }, [notices, pendingNews, acknowledge, markPendingSeen]);

  return createElement(NoticesContext.Provider, { value }, children);
}

export function useNotices(): NoticesContextType {
  return useContext(NoticesContext);
}
