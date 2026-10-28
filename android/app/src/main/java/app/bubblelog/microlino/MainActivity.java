package app.bubblelog.microlino;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Fahrsensoren.class);   // eigenes Plugin in diesem Ordner, kommt nicht über npm
        super.onCreate(savedInstanceState);
    }
}
