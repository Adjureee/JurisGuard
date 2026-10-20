import { useEffect, useState, type ReactNode } from "react";
import { API_ORIGIN, apiClient, TOKEN_STORAGE_KEY } from "../api/client";

type Props = {
  path?: string | null;
  alt?: string;
  className?: string;
  fallback?: ReactNode;
};

export default function ProtectedProfileImage({ path, alt = "", className, fallback = null }: Props) {
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    // Only fetch locally stored profile images; never attach credentials to arbitrary URLs.
    if (!path?.startsWith("/uploads/profiles/") || !sessionStorage.getItem(TOKEN_STORAGE_KEY)) return;
    void apiClient.get<Blob>(`${API_ORIGIN}${path}`, { responseType: "blob" }).then((response) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(response.data);
      setLoaded({ path, url: objectUrl });
    }).catch(() => {
      if (!cancelled) setLoaded(null);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return loaded && loaded.path === path ? <img src={loaded.url} alt={alt} className={className} /> : <>{fallback}</>;
}
