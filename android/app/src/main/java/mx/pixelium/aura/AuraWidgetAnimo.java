package mx.pixelium.aura;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * AURA — Widget "¿Cómo te sientes?"
 *
 * Cinco caras en la pantalla de inicio. Un toque y queda registrado
 * sin abrir la app. Es el widget que de verdad sirve: le quita toda la
 * fricción a la única acción que enciende una estrella.
 *
 * LO QUE NO PUEDE HACER, Y HAY QUE SABERLO
 * Este código corre en el proceso del lanzador. No tiene sesión de
 * Firebase, ni el SDK, ni forma de escribir en Firestore. Así que
 * apunta el registro en SharedPreferences y la app lo recoge al
 * abrirse.
 *
 * Consecuencia práctica: el ánimo marcado desde el widget aparece en
 * la gráfica y en el cielo hasta el siguiente arranque de la app. La
 * alternativa sería meter Firebase en el widget, que significa
 * arrastrar el SDK y las credenciales a un proceso que vive en la
 * pantalla de inicio. No vale la pena por unos minutos de retraso.
 *
 * NO MUESTRA LO REGISTRADO
 * La cara elegida se marca hasta que la app confirma. Un widget que
 * anuncia "hoy te sientes mal" a media pantalla de inicio es justo lo
 * que no queremos.
 */
public class AuraWidgetAnimo extends AppWidgetProvider {

    private static final String ACCION = "mx.pixelium.aura.ANIMO";
    private static final String EXTRA_VALOR = "valor";
    private static final String LLAVE_MARCA = "aura_widget_marca";

    private static final int[] VISTAS = {
        R.id.animo_1, R.id.animo_2, R.id.animo_3, R.id.animo_4, R.id.animo_5
    };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) pintar(ctx, mgr, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (!ACCION.equals(intent.getAction())) return;

        int valor = intent.getIntExtra(EXTRA_VALOR, 0);
        if (valor < 1 || valor > 5) return;

        String hoy = hoyLocal();
        try {
            // La MISMA gaveta que lee @capacitor/preferences, con el
            // formato que espera js/aura-widget.js.
            SharedPreferences p = ctx.getSharedPreferences(
                AuraDatos.GAVETA_CAPACITOR, Context.MODE_PRIVATE);
            JSONObject o = new JSONObject();
            o.put("valor", valor);
            o.put("fecha", hoy);
            p.edit()
             .putString(AuraDatos.LLAVE_ANIMO, o.toString())
             // La marca es solo para pintar el widget mientras la app
             // no confirma. Va aparte para no ensuciar el dato real.
             .putString(LLAVE_MARCA, hoy + ":" + valor)
             .apply();
        } catch (Exception e) {
            return;
        }
        refrescarTodos(ctx);
    }

    static void refrescarTodos(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, AuraWidgetAnimo.class));
        for (int id : ids) pintar(ctx, mgr, id);
    }

    /** Fecha local, no UTC: en México, después de las 18:00 no son el mismo día. */
    private static String hoyLocal() {
        Calendar c = Calendar.getInstance();
        return String.format("%04d-%02d-%02d",
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    private static void pintar(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_animo);

        SharedPreferences p = ctx.getSharedPreferences(
            AuraDatos.GAVETA_CAPACITOR, Context.MODE_PRIVATE);
        String marca = p.getString(LLAVE_MARCA, "");
        String hoy = hoyLocal();

        int elegida = 0;
        if (marca.startsWith(hoy + ":")) {
            try { elegida = Integer.parseInt(marca.substring(hoy.length() + 1)); }
            catch (Exception e) { elegida = 0; }
        }

        v.setTextViewText(R.id.animo_titulo,
            elegida > 0 ? "Registrado hoy" : "¿Cómo te sientes?");

        for (int i = 0; i < 5; i++) {
            int valor = i + 1;
            // Cuando ya hay registro, la elegida se ve llena y las
            // demás tenues. Cuando no, las cinco se ven igual de vivas.
            boolean viva = (elegida == 0) || (elegida == valor);
            v.setImageViewBitmap(VISTAS[i], AuraDatos.dibujarCara(valor, 132, viva));
            v.setOnClickPendingIntent(VISTAS[i], toque(ctx, valor));
        }

        v.setOnClickPendingIntent(R.id.animo_titulo, AuraWidgetCielo.abrirApp(ctx));
        mgr.updateAppWidget(id, v);
    }

    private static PendingIntent toque(Context ctx, int valor) {
        Intent i = new Intent(ctx, AuraWidgetAnimo.class);
        i.setAction(ACCION);
        i.putExtra(EXTRA_VALOR, valor);
        // requestCode distinto por cara: con el mismo, Android reusa el
        // primer PendingIntent y las cinco acaban registrando lo mismo.
        return PendingIntent.getBroadcast(ctx, 7100 + valor, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
