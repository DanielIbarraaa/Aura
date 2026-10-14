package mx.pixelium.aura;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * AURA — Widget "Tu cielo".
 *
 * Muestra la constelación en curso con sus estrellas encendidas y el
 * total de días. No hace nada al tocarlo más que abrir la app: es una
 * vitrina, no un control.
 *
 * NO MUESTRA NADA PRIVADO, A PROPÓSITO
 * Un widget vive en la pantalla de inicio, a la vista de cualquiera
 * que levante el teléfono. Aquí no va el ánimo registrado, ni el
 * diario, ni nada de aurorIA. Un número de días y una figura de
 * estrellas no le dicen a nadie cómo está la persona — que es justo lo
 * que la app promete cuidar.
 */
public class AuraWidgetCielo extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) pintar(ctx, mgr, id);
    }

    static void refrescarTodos(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, AuraWidgetCielo.class));
        for (int id : ids) pintar(ctx, mgr, id);
    }

    private static void pintar(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_cielo);
        JSONObject d = AuraDatos.leerCielo(ctx);

        if (d == null) {
            // Todavía no hay datos: la app no se ha abierto desde que
            // se puso el widget. Se dice, en vez de dejar un cuadro en
            // blanco que parece un error.
            v.setTextViewText(R.id.cielo_nombre, "Tu cielo");
            v.setTextViewText(R.id.cielo_progreso, "Abre Aura para empezar");
            v.setTextViewText(R.id.cielo_dias, "—");
            v.setImageViewBitmap(R.id.cielo_mapa,
                AuraDatos.dibujarCielo("", "", 0, 240));
        } else {
            String nombre = d.optString("nombre", "Tu cielo");
            int encendidas = d.optInt("encendidas", 0);
            int total = d.optInt("total", 7);
            int dias = d.optInt("dias", 0);

            v.setTextViewText(R.id.cielo_nombre, nombre);
            v.setTextViewText(R.id.cielo_progreso,
                encendidas == 0
                    ? "Constelación nueva"
                    : encendidas + " de " + total + " estrellas");
            v.setTextViewText(R.id.cielo_dias, String.valueOf(dias));

            Bitmap b = AuraDatos.dibujarCielo(
                d.optString("puntos", ""), d.optString("lineas", ""), encendidas, 240);
            v.setImageViewBitmap(R.id.cielo_mapa, b);
        }

        v.setOnClickPendingIntent(R.id.cielo_raiz, abrirApp(ctx));
        mgr.updateAppWidget(id, v);
    }

    static PendingIntent abrirApp(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // FLAG_IMMUTABLE es obligatorio desde Android 12: sin él la app
        // ni siquiera arranca.
        return PendingIntent.getActivity(ctx, 0, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
