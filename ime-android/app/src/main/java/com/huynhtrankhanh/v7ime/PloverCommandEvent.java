package com.huynhtrankhanh.v7ime;

final class PloverCommandEvent {
    enum ArgumentKind { STROKE, TRANSLATION, UNSPECIFIED }
    enum Type {
        LOOKUP,
        ADD_TRANSLATION,
        CONFIGURE,
        UNKNOWN
    }

    final Type type;
    final String argument;
    final ArgumentKind argumentKind;

    PloverCommandEvent(Type type, String argument, String argumentKind) {
        this.type = type;
        this.argument = argument == null ? "" : argument;
        this.argumentKind = argumentKindFor(argumentKind);
    }

    static ArgumentKind argumentKindFor(String value) {
        if ("stroke".equals(value)) return ArgumentKind.STROKE;
        if ("translation".equals(value)) return ArgumentKind.TRANSLATION;
        return ArgumentKind.UNSPECIFIED;
    }

    static Type typeFor(String event, String command) {
        String normalizedEvent = event == null ? "" : event.trim();
        String normalizedCommand = command == null ? "" : command.trim();
        if ("plover:lookup".equals(normalizedEvent)
                || "lookup".equals(normalizedCommand)) {
            return Type.LOOKUP;
        }
        if ("plover:add_translation".equals(normalizedEvent)
                || "add_translation".equals(normalizedCommand)) {
            return Type.ADD_TRANSLATION;
        }
        if ("plover:configure".equals(normalizedEvent)
                || "configure".equals(normalizedCommand)) {
            return Type.CONFIGURE;
        }
        return Type.UNKNOWN;
    }
}
