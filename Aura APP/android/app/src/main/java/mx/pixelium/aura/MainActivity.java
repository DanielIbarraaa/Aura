package mx.pixelium.aura;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // El plugin de los widgets se registra ANTES de super.onCreate:
        // después, el puente ya arrancó y no lo toma.
        registerPlugin(AuraWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
