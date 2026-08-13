package com.huynhtrankhanh.v7ime;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class PloverCommandEventTest {
    @Test
    public void parsesExplicitArgumentKindsAndKeepsUntypedArgumentsUnspecified() {
        assertEquals(
                PloverCommandEvent.ArgumentKind.STROKE,
                PloverCommandEvent.argumentKindFor("stroke")
        );
        assertEquals(
                PloverCommandEvent.ArgumentKind.TRANSLATION,
                PloverCommandEvent.argumentKindFor("translation")
        );
        assertEquals(
                PloverCommandEvent.ArgumentKind.UNSPECIFIED,
                PloverCommandEvent.argumentKindFor("")
        );
    }
    @Test
    public void recognizesEverySupportedEventName() {
        assertEquals(
                PloverCommandEvent.Type.LOOKUP,
                PloverCommandEvent.typeFor("plover:lookup", "")
        );
        assertEquals(
                PloverCommandEvent.Type.ADD_TRANSLATION,
                PloverCommandEvent.typeFor("plover:add_translation", "")
        );
        assertEquals(
                PloverCommandEvent.Type.CONFIGURE,
                PloverCommandEvent.typeFor("plover:configure", "")
        );
    }

    @Test
    public void acceptsCommandFieldAndRejectsUnknownEvents() {
        assertEquals(
                PloverCommandEvent.Type.ADD_TRANSLATION,
                PloverCommandEvent.typeFor("", "add_translation")
        );
        assertEquals(
                PloverCommandEvent.Type.UNKNOWN,
                PloverCommandEvent.typeFor("dictionary_state", "")
        );
    }
}
