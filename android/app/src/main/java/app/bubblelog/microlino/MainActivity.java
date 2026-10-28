package app.bubblelog.microlino;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Fahrsensoren.class);   // eigene Plugins in diesem Ordner, kommen nicht über npm
        registerPlugin(Texterkennung.class);
        super.onCreate(savedInstanceState);
    }
}
