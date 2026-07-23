package com.huynhtrankhanh.v7ime;

final class PloverCommandEvent {
    enum Type {
        LOOKUP,
        ADD_TRANSLATION,
        CONFIGURE,
        UNKNOWN
    }

    final Type type;
    final String argument;

    PloverCommandEvent(Type type, String argument) {
        this.type = type;
        this.argument = argument == null ? "" : argument;
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
