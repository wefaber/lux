import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

interface NoticesContextType {
  /** El aviso sin ver sobre un elemento, si hay */
  noticeFor: (entityType: NoticeEntity, entityId: string) => Notice | undefined;
  /** Si hay algun aviso sin ver en una seccion (para el punto del menu) */
  hasNotices: (entityType: NoticeEntity) => boolean;
  /** Lo marca como visto: se desfija de la lista */
  acknowledge: (id: string) => Promise<void>;
}

// Sin provider (por ejemplo en el panel de administracion) no hay avisos
const EMPTY: NoticesContextType = {
  noticeFor: () => undefined,
  hasNotices: () => false,
  acknowledge: async () => {},
};

const NoticesContext = createContext<NoticesContextType>(EMPTY);

const key = (entityType: NoticeEntity, entityId: string) => `${entityType}:${entityId}`;

// Los avisos se vuelven a pedir al cambiar de pagina o de usuario: los provoca
// otra persona, asi que no hay una accion propia despues de la cual refrescar
export function NoticesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    if (!user) {
      setNotices([]);
      return;
    }
    let cancelled = false;
    gql<{ notices: Notice[] }>(NOTICES_QUERY)
      .then((data) => {
        if (!cancelled) setNotices(data.notices);
      })
      .catch(() => {
        // Sin avisos no se rompe nada: se reintenta en la proxima navegacion
      });
    return () => {
      cancelled = true;
    };
  }, [user, pathname]);

  const acknowledge = useCallback(async (id: string) => {
    await gql(ACKNOWLEDGE_MUTATION, { id });
    setNotices((current) => current.filter((n) => n.id !== id));
  }, []);

  const value = useMemo<NoticesContextType>(() => {
    const byEntity = new Map(notices.map((n) => [key(n.entityType, n.entityId), n]));
    const sections = new Set(notices.map((n) => n.entityType));
    return {
      noticeFor: (entityType, entityId) => byEntity.get(key(entityType, entityId)),
      hasNotices: (entityType) => sections.has(entityType),
      acknowledge,
    };
  }, [notices, acknowledge]);

  return createElement(NoticesContext.Provider, { value }, children);
}

export function useNotices(): NoticesContextType {
  return useContext(NoticesContext);
}
