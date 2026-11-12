import { useCallback, useEffect, useState } from "react";
import { FlatList, Text } from "react-native";

import AdminShell, { useRoleGate } from "@/components/AdminShell";
import { AuditEntry, listAudit } from "@/lib/services/admin.service";
import { describeBackendError } from "@/lib/services/staff.service";

/** Bitacora de acciones administrativas (solo lectura). Requiere AUDIT_TABLE_ID en el servidor. */
const Audit = () => {
    const allowed = useRoleGate("admin");
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [enabled, setEnabled] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setError(null);
            const r = await listAudit();
            setEnabled(r.enabled);
            setEntries(r.entries);
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { if (allowed) load(); }, [allowed, load]);

    return (
        <AdminShell title="Bitácora" allowed={allowed} loading={loading} error={error}>
            {!enabled && <Text className="mx-5 mb-3 text-sm text-amber-600">La bitácora no está configurada (falta AUDIT_TABLE_ID / tabla audit_log).</Text>}
            <FlatList
                data={entries}
                keyExtractor={(e) => e.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                ListEmptyComponent={<Text className="mt-6 text-center text-gray-400">Sin registros.</Text>}
                renderItem={({ item: e }) => (
                    <Text className="mb-2 border-b border-gray-100 pb-2 text-sm text-dark-100">
                        {e.summary}{"\n"}<Text className="text-xs text-gray-500">{new Date(e.at).toLocaleString("es-MX")} · {e.actorRole ?? "?"} · {e.action}</Text>
                    </Text>
                )}
            />
        </AdminShell>
    );
};

export default Audit;
