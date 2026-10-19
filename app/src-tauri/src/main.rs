// На Windows не показувати консольне вікно у релізній збірці
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gryadka_lib::run()
}
