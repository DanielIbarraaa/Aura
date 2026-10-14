package mx.pixelium.aura;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;

import org.json.JSONObject;

/**
 * AURA — Lo que los dos widgets comparten.
 *
 * EL PUENTE
 * Un widget corre en el proceso del lanzador: no tiene WebView y no
 * puede ejecutar nada de la app web. Lo único en común es el disco.
 * La app deja un resumen en SharedPreferences (a través de
 * @capacitor/preferences, que en Android escribe justo ahí) y aquí se
 * lee.
 *
 * POR QUÉ SE BUSCA EN DOS GAVETAS
 * @capacitor/preferences guarda en "CapacitorStorage" mientras nadie
 * llame a Preferences.configure({group}). Si algún día se configura un
 * grupo distinto, el widget se quedaría mudo sin ningún error visible
 * —lo peor que puede pasar— así que se prueban las dos y se usa la que
 * tenga el dato.
 */
final class AuraDatos {

    static final String GAVETA_CAPACITOR = "CapacitorStorage";
    static final String GAVETA_ALTERNA   = "AuraWidget";

    static final String LLAVE_CIELO = "aura_widget_cielo";
    static final String LLAVE_ANIMO = "aura_widget_animo";

    private AuraDatos() {}

    /** Devuelve la gaveta donde de verdad está el dato. */
    static SharedPreferences gaveta(Context ctx, String llave) {
        SharedPreferences p = ctx.getSharedPreferences(GAVETA_CAPACITOR, Context.MODE_PRIVATE);
        if (p.contains(llave)) return p;
        SharedPreferences q = ctx.getSharedPreferences(GAVETA_ALTERNA, Context.MODE_PRIVATE);
        if (q.contains(llave)) return q;
        return p;   // para escribir, la de Capacitor es la que la app lee
    }

    static JSONObject leerCielo(Context ctx) {
        try {
            String s = gaveta(ctx, LLAVE_CIELO).getString(LLAVE_CIELO, null);
            if (s == null || s.length() == 0) return null;
            return new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    /* ---------- la paleta, la misma del CSS ---------- */
    static final int LAVANDA   = Color.parseColor("#B7B2EA");
    static final int MORADO    = Color.parseColor("#867BB8");
    static final int MORADO_HD = Color.parseColor("#6E6399");
    static final int ORO       = Color.parseColor("#EEDAA2");
    static final int ORO_HONDO = Color.parseColor("#C9A44C");
    static final int TEXTO     = Color.parseColor("#342852");
    static final int TEXTO_TEN = Color.parseColor("#43375C");

    /**
     * Dibuja la constelación.
     *
     * El encuadre se calcula por constelación, igual que en la web: con
     * un marco fijo, las que ocupan una esquina se ven diminutas al
     * lado de las que cruzan la caja, y el widget parecía mal hecho
     * unos días sí y otros no.
     *
     * Las estrellas apagadas se dibujan igual pero tenues: así se ve a
     * dónde va la figura sin que lo que falta parezca un hueco.
     */
    static Bitmap dibujarCielo(String puntos, String lineas, int encendidas, int lado) {
        Bitmap bmp = Bitmap.createBitmap(lado, lado, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        if (puntos == null || puntos.length() == 0) return bmp;

        String[] ps = puntos.split(";");
        float[] xs = new float[ps.length], ys = new float[ps.length];
        float x0 = 1e9f, x1 = -1e9f, y0 = 1e9f, y1 = -1e9f;
        for (int i = 0; i < ps.length; i++) {
            String[] xy = ps[i].split(",");
            if (xy.length < 2) return bmp;
            xs[i] = Float.parseFloat(xy[0]);
            ys[i] = Float.parseFloat(xy[1]);
            x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]);
            y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i]);
        }

        float margen = 12f;
        float ancho = (x1 - x0) + margen * 2, alto = (y1 - y0) + margen * 2;
        float caja = Math.max(ancho, alto);
        float vx = x0 - margen - (caja - ancho) / 2f;
        float vy = y0 - margen - (caja - alto) / 2f;
        float k = lado / caja;

        // De coordenadas de la constelación a píxeles del mapa.
        float[] px = new float[ps.length], py = new float[ps.length];
        for (int i = 0; i < ps.length; i++) {
            px[i] = (xs[i] - vx) * k;
            py[i] = (ys[i] - vy) * k;
        }

        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        // Las líneas primero, para que las estrellas queden encima.
        if (lineas != null && lineas.length() > 0) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(Math.max(1.6f, lado * 0.008f));
            p.setStrokeCap(Paint.Cap.ROUND);
            for (String l : lineas.split(";")) {
                String[] ab = l.split(",");
                if (ab.length < 2) continue;
                int a = Integer.parseInt(ab[0]), b = Integer.parseInt(ab[1]);
                if (a >= ps.length || b >= ps.length) continue;
                boolean viva = a < encendidas && b < encendidas;
                p.setColor(viva ? ORO : MORADO);
                p.setAlpha(viva ? 130 : 42);
                c.drawLine(px[a], py[a], px[b], py[b], p);
            }
        }

        float r = lado * 0.052f;
        for (int i = 0; i < ps.length; i++) {
            boolean viva = i < encendidas;
            // El halo: lo que hace que una estrella encendida se lea
            // como luz y no como un punto de color.
            if (viva) {
                p.setStyle(Paint.Style.FILL);
                p.setColor(ORO);
                p.setAlpha(52);
                c.drawCircle(px[i], py[i], r * 2.1f, p);
            }
            p.setStyle(Paint.Style.FILL);
            p.setColor(viva ? ORO : MORADO);
            p.setAlpha(viva ? 255 : 70);
            c.drawPath(estrella(px[i], py[i], r), p);
        }
        return bmp;
    }

    /** Estrella de cuatro puntas, la misma forma que la del CSS. */
    private static Path estrella(float cx, float cy, float r) {
        float d = r * 0.26f;
        Path s = new Path();
        s.moveTo(cx, cy - r);
        s.cubicTo(cx + d * .4f, cy - d, cx + d, cy - d * .4f, cx + r, cy);
        s.cubicTo(cx + d, cy + d * .4f, cx + d * .4f, cy + d, cx, cy + r);
        s.cubicTo(cx - d * .4f, cy + d, cx - d, cy + d * .4f, cx - r, cy);
        s.cubicTo(cx - d, cy - d * .4f, cx - d * .4f, cy - d, cx, cy - r);
        s.close();
        return s;
    }

    /* ---------- las caras del ánimo ----------
       Se dibujan en código y no como recursos para que el color salga
       de la misma rampa que usa la app, y para que las cinco queden
       idénticas salvo por la curva de la boca. */
    static final int[] COLOR_ANIMO = {
        Color.parseColor("#8E86C4"),   // 1
        Color.parseColor("#95BAE8"),   // 2
        Color.parseColor("#B7B2EA"),   // 3
        Color.parseColor("#D6A6CE"),   // 4
        Color.parseColor("#A3D9D2")    // 5
    };

    static Bitmap dibujarCara(int valor, int lado, boolean elegida) {
        Bitmap bmp = Bitmap.createBitmap(lado, lado, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        float cx = lado / 2f, cy = lado / 2f, r = lado * 0.42f;

        int col = COLOR_ANIMO[Math.max(0, Math.min(4, valor - 1))];
        p.setStyle(Paint.Style.FILL);
        p.setColor(col);
        p.setAlpha(elegida ? 255 : 90);
        c.drawCircle(cx, cy, r, p);

        if (elegida) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(lado * 0.055f);
            p.setColor(Color.WHITE);
            p.setAlpha(210);
            c.drawCircle(cx, cy, r, p);
        }

        p.setStyle(Paint.Style.FILL);
        p.setColor(TEXTO);
        p.setAlpha(elegida ? 235 : 140);
        float ojo = lado * 0.052f;
        c.drawCircle(cx - r * 0.34f, cy - r * 0.22f, ojo, p);
        c.drawCircle(cx + r * 0.34f, cy - r * 0.22f, ojo, p);

        // La boca: de comisuras abajo en el 1 a comisuras arriba en el
        // 5, pasando por una raya recta en el 3. Es lo único que
        // cambia entre las cinco caras.
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(lado * 0.055f);
        p.setStrokeCap(Paint.Cap.ROUND);
        float curva = (valor - 3) * r * 0.30f;
        Path boca = new Path();
        float bx = r * 0.40f, by = cy + r * 0.30f;
        boca.moveTo(cx - bx, by - curva * 0.5f);
        boca.quadTo(cx, by + curva, cx + bx, by - curva * 0.5f);
        c.drawPath(boca, p);
        return bmp;
    }
}
