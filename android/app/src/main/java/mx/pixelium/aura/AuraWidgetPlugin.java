package mx.pixelium.aura;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * AURA — El único hueco que hacía falta abrir entre la app y los widgets.
 *
 * Android redibuja un widget cada media hora como mucho. Sin esto, el
 * cielo se quedaba desactualizado hasta treinta minutos después de
 * encender una estrella — y esa espera se lee como que no funcionó.
 *
 * Es deliberadamente diminuto: un método que no recibe nada, no
 * devuelve nada y solo pide un repintado. Todo el dato viaja por
 * SharedPreferences.
 */
@CapacitorPlugin(name = "AuraWidget")
public class AuraWidgetPlugin extends Plugin {

    @PluginMethod
    public void refrescar(PluginCall call) {
        try {
            AuraWidgetCielo.refrescarTodos(getContext());
            AuraWidgetAnimo.refrescarTodos(getContext());
        } catch (Exception e) {
            // Que falle un repintado no debe tumbar nada del lado web:
            // los widgets se actualizan solos de todos modos.
        }
        call.resolve();
    }
}
